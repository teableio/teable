import { createFileRoute } from '@tanstack/react-router';
import { playgroundBroadcastLogger } from '@/server/playgroundLogger';
import type { ILogEntry } from '@teable/v2-adapter-logger-pino';

const formatSSEMessage = (entry: ILogEntry): string => {
  return `data: ${JSON.stringify(entry)}\n\n`;
};

async function handleSSE({ request }: { request: Request }) {
  const encoder = new TextEncoder();

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      // Send a connection confirmation message
      const connectEntry: ILogEntry = {
        id: `log-connect-${Date.now()}`,
        timestamp: new Date().toISOString(),
        level: 'info',
        message: '🔗 Log stream connected',
        context: { source: 'log-panel' },
      };
      controller.enqueue(encoder.encode(formatSSEMessage(connectEntry)));

      // Send initial history
      const history = playgroundBroadcastLogger.getHistory();
      for (const entry of history) {
        controller.enqueue(encoder.encode(formatSSEMessage(entry)));
      }

      // Subscribe to new logs
      const unsubscribe = playgroundBroadcastLogger.subscribe((entry) => {
        try {
          controller.enqueue(encoder.encode(formatSSEMessage(entry)));
        } catch {
          // Stream may be closed
          unsubscribe();
        }
      });

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

export const Route = createFileRoute('/api/logs/stream')({
  server: {
    handlers: {
      GET: handleSSE,
    },
  },
});
