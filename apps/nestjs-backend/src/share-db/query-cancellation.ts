import { IdPrefix } from '@teable/core';
import type ShareDB from 'sharedb';

const cancellationScope = Symbol('shareDbQueryCancellation');

type Agent = ShareDB.middleware.ConnectContext['agent'];

interface IQueryEmitter {
  options: unknown;
  destroy(): void;
  onError(error: Error): void;
  queryPoll(callback: (error?: Error | null) => void): void;
}

interface IQueryScope {
  controller: AbortController;
  id: number;
  agent: Agent;
  emitter?: IQueryEmitter;
  repliedWithError?: boolean;
}

type ScopedOptions = { [cancellationScope]?: IQueryScope };

type QueryAgent = Agent & {
  subscribedQueries: Record<number, IQueryEmitter | undefined>;
};

// These instance APIs are present in ShareDB 5.2.2 but absent from @types/sharedb.
type QuerySubscribeCallback = (
  error: Error | null,
  emitter?: IQueryEmitter,
  results?: ShareDB.Snapshot[],
  extra?: unknown
) => void;

type QueryBackend = ShareDB & {
  querySubscribe(
    agent: Agent,
    collection: string,
    query: unknown,
    options: unknown,
    callback: QuerySubscribeCallback
  ): void;
};

function getScope(options: unknown): IQueryScope | undefined {
  if (!options || typeof options !== 'object') return;
  const scopedOptions = options as ScopedOptions;
  return scopedOptions[cancellationScope];
}

export function getQueryCancellationSignal(options: unknown): AbortSignal | undefined {
  return getScope(options)?.controller.signal;
}

export class ShareDbQueryCancelledError extends Error {
  readonly code = 'ERR_QUERY_CANCELLED';

  constructor() {
    super('ShareDB query was cancelled');
    this.name = 'ShareDbQueryCancelledError';
  }
}

/** Register before authentication: its query-options spread preserves the private Symbol. */
export function registerQueryCancellation(backend: ShareDB): void {
  const scopes = new WeakMap<Agent, Map<number, IQueryScope>>();

  const remove = (scope: IQueryScope) => {
    const queries = scopes.get(scope.agent);
    if (queries?.get(scope.id) === scope) queries.delete(scope.id);
  };

  const destroyEmitter = (scope: IQueryScope) => {
    scope.emitter?.destroy();
    const agent = scope.agent as QueryAgent;
    const emitter = agent.subscribedQueries[scope.id];
    // A late reply must not unsubscribe a newer use of the same query ID.
    if (emitter && getScope(emitter.options) === scope) {
      emitter.destroy();
      delete agent.subscribedQueries[scope.id];
    }
  };

  const queryBackend = backend as QueryBackend;
  const querySubscribe = queryBackend.querySubscribe;
  queryBackend.querySubscribe = function (agent, collection, query, options, callback) {
    const scope = getScope(options);
    if (!scope) return querySubscribe.call(this, agent, collection, query, options, callback);
    querySubscribe.call(
      this,
      agent,
      collection,
      query,
      options,
      (error, emitter, results, extra) => {
        // The DB/backend completion has drained. Reconnect fetchOps may already have
        // replied with an error, or this ID may now belong to another query. Installing
        // this emitter would destroy the new one, and a stale reply would reset its data.
        const current = scopes.get(agent)?.get(scope.id);
        if (scope.repliedWithError || (current && current !== scope)) return emitter?.destroy();
        if (error || !emitter) return callback(error, emitter, results, extra);
        scope.emitter = emitter;

        const queryPoll = emitter.queryPoll;
        let reconnectPoll = !results;
        emitter.queryPoll = function (done) {
          const initialPoll = reconnectPoll;
          reconnectPoll = false;
          const finish = (pollError?: Error | null) => {
            if (scope.controller.signal.aborted) {
              // Stock _finishPoll calls _flushPoll after this callback, even after
              // destroy(). Clear any interval/debounce it re-arms after unwinding.
              queueMicrotask(() => emitter.destroy());
            }
            if (initialPoll) {
              // Reconnect's first poll belongs to the initial request. Its canceled
              // completion is an acknowledgement, not a valid empty-results diff.
              const owner = scopes.get(agent)?.get(scope.id);
              if (scope.repliedWithError || (owner && owner !== scope)) return emitter.destroy();
              if (
                scope.controller.signal.aborted &&
                pollError instanceof ShareDbQueryCancelledError
              ) {
                return done?.();
              }
            }
            if (done) done(pollError);
            else if (pollError) emitter.onError(pollError);
          };
          if (scope.controller.signal.aborted) return finish(new ShareDbQueryCancelledError());
          queryPoll.call(this, finish);
        };

        try {
          callback(null, emitter, scope.controller.signal.aborted ? [] : results, extra);
          const onError = emitter.onError;
          emitter.onError = (pollError) => {
            if (scope.controller.signal.aborted && pollError instanceof ShareDbQueryCancelledError)
              return;
            onError(pollError);
          };
        } finally {
          if (scope.controller.signal.aborted) destroyEmitter(scope);
        }
      }
    );
  };

  backend.use('connect', ({ agent }, next) => {
    const queries = new Map<number, IQueryScope>();
    scopes.set(agent, queries);
    const disconnect = () => {
      agent.stream.removeListener('end', disconnect);
      agent.stream.removeListener('close', disconnect);
      for (const scope of queries.values()) scope.controller.abort();
      queries.clear();
      scopes.delete(agent);
    };
    agent.stream.once('end', disconnect);
    agent.stream.once('close', disconnect);
    next();
  });

  backend.use('receive', ({ agent, data }, next) => {
    const queries = scopes.get(agent);
    if (!queries || typeof data.id !== 'number') return next();
    if (data.a === 'qu') {
      const scope = queries.get(data.id);
      if (scope) {
        scope.controller.abort();
        remove(scope);
      }
    } else if (
      data.a === 'qs' &&
      typeof data.c === 'string' &&
      data.c.startsWith(`${IdPrefix.Record}_`)
    ) {
      queries.get(data.id)?.controller.abort();
      const scope: IQueryScope = { controller: new AbortController(), id: data.id, agent };
      queries.set(data.id, scope);
      // Enumerable Symbols survive auth's object spread, but JSON serialization omits them.
      data.o = { ...data.o, [cancellationScope]: scope };
    }
    next();
  });

  backend.use('reply', ({ request }, next) => {
    if (request.a !== 'qs') return next();
    const scope = getScope(request.o);
    if (scope?.controller.signal.aborted) {
      destroyEmitter(scope);
      remove(scope);
    }
    next();
  });

  // ShareDB 5.2.2 sends errors with the original request object and bypasses reply middleware.
  backend.on('send', (_agent, message) => {
    if (message.a !== 'qs' || !('error' in message)) return;
    const scope = getScope('o' in message ? message.o : undefined);
    if (!scope) return;
    scope.repliedWithError = true;
    scope.controller.abort();
    destroyEmitter(scope);
    remove(scope);
  });
}
