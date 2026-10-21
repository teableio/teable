import type { Response } from 'express';

type IFlushableResponse = Response & { flush?: () => void };

const HEARTBEAT_INTERVAL_MS = 15_000;

export const isSseStreamClosed = (response: Response) =>
  response.writableEnded || response.destroyed;

export const sendSseEvent = (response: Response, data: unknown) => {
  if (isSseStreamClosed(response)) {
    return;
  }

  response.write(`data: ${JSON.stringify(data)}\n\n`);
  (response as IFlushableResponse).flush?.();
};

// Writes an AsyncIterable of events to the response as an SSE stream: sets the SSE
// headers, keeps proxies from timing out the connection with comment heartbeats, and
// maps a thrown error to one final event produced by buildErrorEvent.
export const streamSseResponse = async <T>(
  response: Response,
  stream: AsyncIterable<T>,
  buildErrorEvent: (error: unknown) => T
): Promise<void> => {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();

  const heartbeat = setInterval(() => {
    if (isSseStreamClosed(response)) {
      return;
    }

    response.write(': ping\n\n');
    (response as IFlushableResponse).flush?.();
  }, HEARTBEAT_INTERVAL_MS);
  response.on('close', () => clearInterval(heartbeat));

  try {
    for await (const event of stream) {
      if (isSseStreamClosed(response)) {
        break;
      }
      sendSseEvent(response, event);
    }
  } catch (error) {
    sendSseEvent(response, buildErrorEvent(error));
  } finally {
    clearInterval(heartbeat);
    response.end();
  }
};
