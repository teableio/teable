import { performance } from 'perf_hooks';
import type { IPermessageDeflateExtension, IPermessageDeflateSession } from 'permessage-deflate';
import {
  recordCompressionFrame,
  recordCompressionSessionClose,
  recordCompressionSessionOpen,
} from '../share-db/metrics/compression-metrics';

const instrumentSession = (session: IPermessageDeflateSession): IPermessageDeflateSession => {
  recordCompressionSessionOpen();

  // websocket-extensions closes the session exactly once when the pipeline
  // drains (pipeline/cell.js), but guard anyway — a double decrement would
  // quietly turn the memory multiplier negative.
  let closed = false;

  return {
    generateResponse: () => session.generateResponse(),

    close() {
      if (!closed) {
        closed = true;
        recordCompressionSessionClose();
      }
      session.close();
    },

    processOutgoingMessage(message, callback) {
      const plain = message.data.length;
      const started = performance.now();
      session.processOutgoingMessage(message, (error, result) => {
        if (!error && result) {
          recordCompressionFrame(
            'outbound',
            plain,
            result.data.length,
            performance.now() - started
          );
        }
        callback(error, result);
      });
    },

    processIncomingMessage(message, callback) {
      // Inbound arrives compressed and leaves inflated, so the sizes swap
      // sides. Not timed: inflate over small ShareDB ops tells us nothing
      // outbound has not already shown, and a second histogram would cost
      // another 9 samples per export.
      const wire = message.data.length;
      session.processIncomingMessage(message, (error, result) => {
        if (!error && result) recordCompressionFrame('inbound', result.data.length, wire);
        callback(error, result);
      });
    },
  };
};

/**
 * Wraps a configured permessage-deflate extension so every session and frame
 * lands in the realtime.compression.* metrics.
 *
 * `deflate.configure()` returns an object whose `name`/`type`/`rsv*` live on the
 * prototype, so they are copied across explicitly — spreading would drop them
 * and websocket-extensions would silently refuse to register the extension.
 */
export const instrumentDeflate = (
  extension: IPermessageDeflateExtension
): IPermessageDeflateExtension => ({
  name: extension.name,
  type: extension.type,
  rsv1: extension.rsv1,
  rsv2: extension.rsv2,
  rsv3: extension.rsv3,
  configure: (options) => extension.configure(options),

  createServerSession(offers) {
    const session = extension.createServerSession(offers);
    return session ? instrumentSession(session) : null;
  },
});
