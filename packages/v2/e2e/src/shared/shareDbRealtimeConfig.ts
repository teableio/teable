import {
  ShareDbBackendPresencePublisher,
  type IV2ShareDbRealtimeConfig,
  type IShareDbOpPublisher,
} from '@teable/v2-adapter-realtime-sharedb';
import type ShareDb from 'sharedb';

/**
 * Realtime wiring shared by the v2 e2e runtimes. The compute-activity channel
 * and action key mirror the app contract (`@teable/core`); specs that assert
 * the wire format pin their own literals.
 */
export const createShareDbRealtimeConfig = (
  backend: ShareDb,
  publisher: IShareDbOpPublisher
): IV2ShareDbRealtimeConfig => ({
  publisher,
  presence: new ShareDbBackendPresencePublisher(backend),
  computeActivitySignal: {
    resolveChannel: (tableId) => `__action_trigger_${tableId}`,
    actionKey: 'computeActivityChanged',
  },
});
