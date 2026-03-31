import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getSessionDetail } from '@/lib/parsers';
import { persistSessionSummary } from '@/lib/session-state';
import { generateSummaryWithFallback } from '@/lib/summarizer/service';
import { getSpinnerVerbs, getSummaryEngineLabel, SummaryEngine, usesSyntheticSpinner } from '@/lib/summarizer/spinner-verbs';

const MAX_BATCH_SUMMARY_CONCURRENCY = 3;

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
      const spinnerTimers = new Map<string, ReturnType<typeof setInterval>>();
      let closed = false;
      let cancelled = false;
      let nextIndex = 0;
      const results: Array<{ id: string; success: boolean; error?: string }> = [];

      const send = (event: string, data: unknown) => {
        if (closed || cancelled) return;

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const stopSpinner = (sessionId: string) => {
        const timer = spinnerTimers.get(sessionId);
        if (!timer) return;
        clearInterval(timer);
        spinnerTimers.delete(sessionId);
      };

      const stopAllSpinners = () => {
        for (const timer of spinnerTimers.values()) {
          clearInterval(timer);
        }
        spinnerTimers.clear();
      };

      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const startSpinner = (sessionId: string, engine: SummaryEngine, fallback: boolean) => {
        stopSpinner(sessionId);

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

        const timer = setInterval(() => {
          verbIndex = (verbIndex + 1) % verbs.length;
          send('status', {
            id: sessionId,
            phase: 'running',
            engine,
            engineLabel,
            verb: verbs[verbIndex],
          });
        }, 1200);

        spinnerTimers.set(sessionId, timer);
      };

      request.signal.addEventListener('abort', () => {
        cancelled = true;
        stopAllSpinners();
        close();
      });

      const runOne = async (id: string, index: number, primaryEngine: SummaryEngine) => {
        try {
          send('status', {
            id,
            index,
            phase: 'loading-session',
            message: 'Loading session context',
          });

          const detail = await getSessionDetail(id);
          if (!detail) {
            throw new Error('Session not found');
          }

          if (cancelled) return;

          send('session-start', {
            id,
            title: detail.title,
            index,
            total: ids.length,
          });

          const result = await generateSummaryWithFallback(detail, primaryEngine, {
            onEvent: event => {
              if (cancelled) return;

              if (event.type === 'fallback') {
                stopSpinner(id);
                send('status', {
                  id,
                  index,
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
                stopSpinner(id);
              }
            },
            onStatus: status => {
              if (cancelled) return;

              send('status', {
                id,
                index,
                phase: 'running',
                engine: status.engine,
                engineLabel: getSummaryEngineLabel(status.engine),
                message: status.message,
                source: status.source,
              });
            },
          });

          if (cancelled) return;

          stopSpinner(id);
          send('status', {
            id,
            index,
            phase: 'persisting',
            engine: result.engineUsed,
            engineLabel: getSummaryEngineLabel(result.engineUsed),
            message: 'Saving summary',
          });

          persistSessionSummary(id, result.summary);
          results.push({ id, success: true });

          send('session-complete', {
            id,
            index,
            title: detail.title,
            summary: result.summary,
            engine: result.engineUsed,
            engineLabel: getSummaryEngineLabel(result.engineUsed),
            fallbackUsed: result.fallbackUsed,
          });
        } catch (error) {
          stopSpinner(id);
          const message = error instanceof Error ? error.message : 'Unknown error';
          results.push({ id, success: false, error: message });
          send('session-error', { id, index, error: message });
        }
      };

      const worker = async (primaryEngine: SummaryEngine) => {
        while (!cancelled) {
          const current = nextIndex;
          nextIndex += 1;

          if (current >= ids.length) {
            return;
          }

          await runOne(ids[current], current + 1, primaryEngine);
        }
      };

      try {
        const db = getDb();
        const setting = db.prepare("SELECT value FROM settings WHERE key = 'summary_cli'").get() as { value: string } | undefined;
        const primaryEngine = (setting?.value || 'claude-code') as SummaryEngine;
        const concurrency = Math.min(MAX_BATCH_SUMMARY_CONCURRENCY, ids.length);

        send('batch-start', {
          total: ids.length,
          concurrency,
        });

        await Promise.all(Array.from({ length: concurrency }, () => worker(primaryEngine)));

        if (cancelled) {
          return;
        }

        const successCount = results.filter(result => result.success).length;
        const failureCount = results.length - successCount;
        send('complete', { successCount, failureCount, results });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        stopAllSpinners();
        send('error', { error: message });
      } finally {
        stopAllSpinners();
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
