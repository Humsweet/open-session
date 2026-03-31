import { NextRequest, NextResponse } from 'next/server';
import { getSessionDetail } from '@/lib/parsers';
import { getDb } from '@/lib/db/client';
import { persistSessionSummary } from '@/lib/session-state';
import { getSpinnerVerbs, getSummaryEngineLabel, SummaryEngine, usesSyntheticSpinner } from '@/lib/summarizer/spinner-verbs';
import { generateSummaryWithFallback } from '@/lib/summarizer/service';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let spinnerTimer: ReturnType<typeof setInterval> | null = null;
      let closed = false;

      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
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

      const startSpinner = (engine: SummaryEngine, fallback: boolean) => {
        cleanup();

        const engineLabel = getSummaryEngineLabel(engine);

        send('status', {
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
          phase: 'running',
          engine,
          engineLabel,
          verb: verbs[verbIndex],
        });

        spinnerTimer = setInterval(() => {
          verbIndex = (verbIndex + 1) % verbs.length;
          send('status', {
            phase: 'running',
            engine,
            engineLabel,
            verb: verbs[verbIndex],
          });
        }, 1200);
      };

      try {
        const { id } = await params;
        send('status', { phase: 'loading-session', message: 'Loading session context' });

        const detail = await getSessionDetail(id);
        if (!detail) {
          send('error', { error: 'Session not found' });
          cleanup();
          close();
          return;
        }

        const db = getDb();
        const setting = db.prepare("SELECT value FROM settings WHERE key = 'summary_cli'").get() as { value: string } | undefined;
        const primaryEngine = (setting?.value || 'claude-code') as SummaryEngine;
        const result = await generateSummaryWithFallback(detail, primaryEngine, {
          onEvent: event => {
            if (event.type === 'fallback') {
              cleanup();
              send('status', {
                phase: 'fallback',
                from: event.from,
                to: event.to,
                engineLabel: getSummaryEngineLabel(event.to),
                message: `${getSummaryEngineLabel(event.from)} failed, falling back to ${getSummaryEngineLabel(event.to)}`,
              });
              return;
            }

            if (event.type === 'attempt-start') {
              startSpinner(event.engine, event.fallback);
              return;
            }

            if (event.type === 'attempt-failed') {
              cleanup();
            }
          },
          onStatus: status => {
            send('status', {
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
          phase: 'persisting',
          engine: result.engineUsed,
          engineLabel: getSummaryEngineLabel(result.engineUsed),
          message: 'Saving summary',
        });

        persistSessionSummary(id, result.summary);

        send('complete', {
          summary: result.summary,
          engine: result.engineUsed,
          engineLabel: getSummaryEngineLabel(result.engineUsed),
          fallbackUsed: result.fallbackUsed,
        });
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
