import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getSessionDetail } from '@/lib/parsers';
import { persistSessionSummary } from '@/lib/session-state';
import { generateSummaryWithFallback } from '@/lib/summarizer/service';
import { getSpinnerVerbs, getSummaryEngineLabel, SummaryEngine, usesSyntheticSpinner } from '@/lib/summarizer/spinner-verbs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids)
    ? (body.ids as unknown[]).filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: 'No session ids provided' }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let spinnerTimer: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      const results: Array<{ id: string; success: boolean; error?: string }> = [];

      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const cleanup = () => {
        if (spinnerTimer) {
          clearInterval(spinnerTimer);
          spinnerTimer = null;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const startSpinner = (sessionId: string, engine: SummaryEngine, fallback: boolean) => {
        cleanup();

        const engineLabel = getSummaryEngineLabel(engine);

        send('status', {
          id: sessionId,
          phase: 'starting',
          engine,
          engineLabel,
          message: fallback ? `Retrying with ${engineLabel}` : `Starting ${engineLabel}`,
        });

        if (!usesSyntheticSpinner(engine)) {
          return;
        }

        const verbs = getSpinnerVerbs(engine);
        let verbIndex = 0;

        send('status', {
          id: sessionId,
          phase: 'running',
          engine,
          engineLabel,
          verb: verbs[verbIndex],
        });

        spinnerTimer = setInterval(() => {
          verbIndex = (verbIndex + 1) % verbs.length;
          send('status', {
            id: sessionId,
            phase: 'running',
            engine,
            engineLabel,
            verb: verbs[verbIndex],
          });
        }, 1200);
      };

      try {
        const db = getDb();
        const setting = db.prepare("SELECT value FROM settings WHERE key = 'summary_cli'").get() as { value: string } | undefined;
        const primaryEngine = (setting?.value || 'claude-code') as SummaryEngine;

        send('batch-start', { total: ids.length });

        for (let index = 0; index < ids.length; index += 1) {
          const id = ids[index];

          try {
            send('status', {
              id,
              phase: 'loading-session',
              message: 'Loading session context',
            });

            const detail = await getSessionDetail(id);
            if (!detail) {
              throw new Error('Session not found');
            }

            send('session-start', {
              id,
              title: detail.title,
              index: index + 1,
              total: ids.length,
            });

            const result = await generateSummaryWithFallback(detail, primaryEngine, {
              onEvent: event => {
                if (event.type === 'fallback') {
                  cleanup();
                  send('status', {
                    id,
                    phase: 'fallback',
                    from: event.from,
                    to: event.to,
                    engineLabel: getSummaryEngineLabel(event.to),
                    message: `${getSummaryEngineLabel(event.from)} failed, falling back to ${getSummaryEngineLabel(event.to)}`,
                  });
                  return;
                }

                if (event.type === 'attempt-start') {
                  startSpinner(id, event.engine, event.fallback);
                  return;
                }

                if (event.type === 'attempt-failed') {
                  cleanup();
                }
              },
              onStatus: status => {
                send('status', {
                  id,
                  phase: 'running',
                  engine: status.engine,
                  engineLabel: getSummaryEngineLabel(status.engine),
                  message: status.message,
                  source: status.source,
                });
              },
            });

            cleanup();
            send('status', {
              id,
              phase: 'persisting',
              engine: result.engineUsed,
              engineLabel: getSummaryEngineLabel(result.engineUsed),
              message: 'Saving summary',
            });

            persistSessionSummary(id, result.summary);
            results.push({ id, success: true });

            send('session-complete', {
              id,
              summary: result.summary,
              engine: result.engineUsed,
              engineLabel: getSummaryEngineLabel(result.engineUsed),
              fallbackUsed: result.fallbackUsed,
            });
          } catch (error) {
            cleanup();
            const message = error instanceof Error ? error.message : 'Unknown error';
            results.push({ id, success: false, error: message });
            send('session-error', { id, error: message });
          }
        }

        const successCount = results.filter(result => result.success).length;
        const failureCount = results.length - successCount;
        send('complete', { successCount, failureCount, results });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        cleanup();
        send('error', { error: message });
      } finally {
        cleanup();
        close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
