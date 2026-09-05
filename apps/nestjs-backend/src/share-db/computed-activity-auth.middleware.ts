import type ShareDB from 'sharedb';
import type { ShareDbAdapter } from './share-db.adapter';

type PendingCheck = { ids: Set<string>; callbacks: Array<(error?: unknown) => void> };

/** Reauthorize live ops, including subscriptions established before permission revocation. */
export const computedActivityAuthMiddleware = (
  backend: ShareDB,
  adapter: Pick<ShareDbAdapter, 'authorizeComputedActivityDocuments'>
) => {
  const pending = new WeakMap<object, Map<string, PendingCheck>>();
  backend.use('op', (context, callback) => {
    if (!context.collection.startsWith('cmp_')) return callback();
    const tableId = context.collection.slice(4);
    const agent = context.agent;
    let tables = pending.get(agent);
    if (!tables) {
      tables = new Map();
      pending.set(agent, tables);
    }
    const existing = tables.get(tableId);
    if (existing) {
      existing.ids.add(context.id);
      existing.callbacks.push(callback);
      return;
    }
    const check: PendingCheck = { ids: new Set([context.id]), callbacks: [callback] };
    tables.set(tableId, check);
    // Batch only this event-loop turn. Never reuse an authorization after a permission change.
    setImmediate(() => {
      tables.delete(tableId);
      void adapter
        .authorizeComputedActivityDocuments(tableId, [...check.ids], { agentCustom: agent.custom })
        .then(() => check.callbacks.forEach((done) => done()))
        .catch(() =>
          check.callbacks.forEach((done) =>
            done(new Error('Computed activity permission unavailable'))
          )
        );
    });
  });
};
