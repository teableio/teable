import ShareDB from 'sharedb';
import type { Connection } from 'sharedb/lib/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from './auth.middleware';
import {
  getQueryCancellationSignal,
  registerQueryCancellation,
  ShareDbQueryCancelledError,
} from './query-cancellation';

const collection = 'rec_tblCancellation';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

// The installed client allocates numeric IDs; @types/sharedb declares Query.id as string.
const queryId = (query: ShareDB.Query): number => {
  const id: unknown = query.id;
  if (typeof id !== 'number') throw new Error('Expected a numeric ShareDB query ID');
  return id;
};

type Phase = 'initial' | 'poll' | 'ops';
interface IPendingRead {
  phase: Phase;
  options: unknown;
  finish(error?: Error): void;
}

/**
 * Real MemoryDB reads behind explicit barriers. This models the adapter contract:
 * only the initial query boundary completes own cancellation with []; a live poll
 * returns the dedicated error, never empty IDs. All non-cancel errors are preserved.
 */
class DelayedMemoryDB extends ShareDB.MemoryDB {
  delayInitial = true;
  delayPoll = false;
  delayOps = false;
  pending: IPendingRead[] = [];

  private schedule(phase: Phase, options: unknown, run: (error?: Error) => void) {
    if (
      (phase === 'initial' && this.delayInitial) ||
      (phase === 'poll' && this.delayPoll) ||
      (phase === 'ops' && this.delayOps)
    ) {
      this.pending.push({ phase, options, finish: run });
    } else {
      run();
    }
  }

  query: ShareDB.DBQueryMethod = (name, query, fields, options, callback) => {
    this.schedule('initial', options, (error) => {
      // ShareDB forwards native errors, although its callback declaration requires a code.
      if (error) return callback(error as Error & ShareDB.Error, []);
      if (getQueryCancellationSignal(options)?.aborted) return callback(null, []);
      ShareDB.MemoryDB.prototype.query.call(this, name, query, fields, options, callback);
    });
  };

  queryPoll(...[name, query, options, callback]: Parameters<ShareDB.MemoryDB['queryPoll']>) {
    this.schedule('poll', options, (error) => {
      if (error) return callback(error);
      if (getQueryCancellationSignal(options)?.aborted) {
        return callback(new ShareDbQueryCancelledError());
      }
      ShareDB.MemoryDB.prototype.query.call(this, name, query, {}, options, (err, snapshots) => {
        callback(
          err,
          snapshots?.map((snapshot) => snapshot.id)
        );
      });
    });
  }

  getOps(...args: Parameters<ShareDB.MemoryDB['getOps']>) {
    this.schedule('ops', args[4], (error) => {
      if (error) return args[5](error);
      ShareDB.MemoryDB.prototype.getOps.call(this, ...args);
    });
  }

  async take(phase: Phase) {
    await vi.waitFor(() => expect(this.pending.some((read) => read.phase === phase)).toBe(true));
    return this.pending.splice(
      this.pending.findIndex((read) => read.phase === phase),
      1
    )[0];
  }
}

interface IEmitter extends Record<'_defaultCallback', (error?: Error) => void> {
  options: unknown;
  streams: unknown[];
  ids: string[];
  queryPoll(callback?: (error?: Error) => void): void;
}

type TestAgent = ShareDB.middleware.ConnectContext['agent'] & {
  closed: boolean;
  subscribedQueries: Record<number, IEmitter | undefined>;
};
type TestConnection = Connection & { agent: TestAgent; nextQueryId: number };
interface IWireMessage {
  a: string;
  id?: number;
  error?: { code: string; message: string };
  data?: unknown;
  diff?: unknown;
}

const fixtures: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of fixtures.splice(0)) await dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup() {
  const db = new DelayedMemoryDB();
  const backend = new ShareDB({ db });
  registerQueryCancellation(backend);
  authMiddleware(backend);
  const connections: TestConnection[] = [];
  const messages: Array<{ agent: TestAgent; message: IWireMessage }> = [];
  const clientErrors: ShareDB.Error[] = [];
  backend.on('send', (agent, message) => {
    messages.push({ agent: agent as TestAgent, message: JSON.parse(JSON.stringify(message)) });
  });
  const connect = async (existing?: TestConnection) => {
    const connection = backend.connect(existing, {
      headers: { cookie: 'session=cancellation' },
      url: '/socket?shareId=shrCancellation',
    }) as TestConnection;
    if (!existing) {
      connections.push(connection);
      connection.on('error', (error) => clientErrors.push(error));
    }
    await vi.waitFor(() => expect(connection.state).toBe('connected'));
    return connection;
  };
  fixtures.push(async () => {
    connections.forEach((connection) => connection.close());
    db.delayInitial = db.delayPoll = db.delayOps = false;
    for (const read of db.pending.splice(0)) read.finish();
    await flush();
    await new Promise<void>((resolve, reject) => {
      backend.close((error) => (error ? reject(error) : resolve()));
    });
  });
  const connection = await connect();
  const doc = connection.get(collection, 'recOne');
  await new Promise<void>((resolve, reject) => {
    doc.create({ value: 1 }, (error) => (error ? reject(error) : resolve()));
  });
  // The installed runtime exposes this counter; @types/sharedb marks it protected.
  const pubsub = backend.pubsub as unknown as { streamsCount: number };
  const streams = () => pubsub.streamsCount;
  const replies = (agent: TestAgent, id: number) =>
    messages.filter(
      (entry) => entry.agent === agent && entry.message.a === 'qs' && entry.message.id === id
    );
  return { backend, db, connection, doc, connect, messages, clientErrors, streams, replies };
}

describe('ShareDB query cancellation lifecycle (installed client/backend/MemoryDB)', () => {
  it('releases pending qs after qu, retaining the auth-spread Symbol but no wire scope', async () => {
    const { db, connection, messages, clientErrors, streams } = await setup();
    const query = connection.createSubscribeQuery(collection, {}, {});
    const read = await db.take('initial');
    const signal = getQueryCancellationSignal(read.options)!;
    expect(signal.aborted).toBe(false);
    expect(read.options).toMatchObject({
      cookie: 'session=cancellation',
      shareId: 'shrCancellation',
    });
    expect(Object.getOwnPropertySymbols(read.options)).toHaveLength(1);
    expect(getQueryCancellationSignal({ ...(read.options as object) })).toBe(signal);
    expect(getQueryCancellationSignal(JSON.parse(JSON.stringify(read.options)))).toBeUndefined();
    expect(streams()).toBe(1);

    query.destroy();
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    expect(query.ready).toBe(false);
    read.finish();
    await vi.waitFor(() => expect(streams()).toBe(0));
    await flush();
    expect(connection.agent.subscribedQueries[queryId(query)]).toBeUndefined();
    expect(messages.filter(({ message }) => message.error)).toEqual([]);
    expect(clientErrors).toEqual([]);
    expect(
      messages.some(({ message }) => message.a === 'qs' && message.id === queryId(query))
    ).toBe(true);
  });

  it('keeps ready ownership for a live poll and cancels without a remove-all diff', async () => {
    const { db, connection, messages, streams } = await setup();
    // ShareDB exports its logger at runtime, but @types/sharedb omits the static member.
    const runtime = ShareDB as unknown as { logger: { error(...args: unknown[]): void } };
    const logError = vi.spyOn(runtime.logger, 'error').mockImplementation(() => undefined);
    const query = connection.createSubscribeQuery(collection, {}, {});
    (await db.take('initial')).finish();
    await vi.waitFor(() => expect(query.ready).toBe(true));
    const emitter = connection.agent.subscribedQueries[queryId(query)]!;
    const signal = getQueryCancellationSignal(emitter.options)!;
    expect(signal.aborted).toBe(false);
    db.delayPoll = true;
    const poll = new Promise<Error | undefined>((resolve) =>
      emitter.queryPoll((error) => {
        emitter._defaultCallback(error);
        resolve(error);
      })
    );
    const read = await db.take('poll');
    query.destroy();
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    read.finish();
    expect(await poll).toBeInstanceOf(ShareDbQueryCancelledError);
    expect(emitter.ids).toEqual(['recOne']);
    expect(query.results.map((doc) => doc.id)).toEqual(['recOne']);
    expect(messages.filter(({ message }) => message.a === 'q' && message.diff)).toEqual([]);
    expect(streams()).toBe(0);
    expect(logError).not.toHaveBeenCalled();
  });

  it('preserves a genuine poll error even when the subscriber has just canceled', async () => {
    const { db, connection } = await setup();
    // The runtime logger is omitted from the package declarations.
    const runtime = ShareDB as unknown as { logger: { error(...args: unknown[]): void } };
    const logError = vi.spyOn(runtime.logger, 'error').mockImplementation(() => undefined);
    const query = connection.createSubscribeQuery(collection, {}, {});
    (await db.take('initial')).finish();
    await vi.waitFor(() => expect(query.ready).toBe(true));
    const emitter = connection.agent.subscribedQueries[queryId(query)]!;
    db.delayPoll = true;
    emitter.queryPoll();
    const read = await db.take('poll');
    query.destroy();
    await vi.waitFor(() => expect(getQueryCancellationSignal(read.options)?.aborted).toBe(true));
    const error = new Error('database unavailable');
    read.finish(error);
    expect(logError).toHaveBeenCalledWith('Query subscription stream error', collection, {}, error);
  });

  it('does not retain a poll interval rearmed after an in-flight canceled poll finishes', async () => {
    const { db, connection, streams } = await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    db.delayInitial = false;
    const options = { results: undefined, pollInterval: 60_000 };
    const query = connection.createSubscribeQuery(collection, {}, options);
    await flush();
    expect(query.ready).toBe(true);
    const emitter = connection.agent.subscribedQueries[queryId(query)]!;
    db.delayPoll = true;
    emitter.queryPoll(emitter._defaultCallback);
    const read = await db.take('poll');
    query.destroy();
    await flush();
    expect(getQueryCancellationSignal(read.options)?.aborted).toBe(true);
    read.finish();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    expect(db.pending).toEqual([]);
    expect(streams()).toBe(0);
    vi.useRealTimers();
  });

  it('isolates identical query IDs on different agents and keeps the other subscription live', async () => {
    const { db, connection: first, connect, doc, streams } = await setup();
    const second = await connect();
    const a = first.createSubscribeQuery(collection, {}, {});
    const aRead = await db.take('initial');
    const b = second.createSubscribeQuery(collection, {}, {});
    const bRead = await db.take('initial');
    expect(a.id).toBe(b.id);
    a.destroy();
    await vi.waitFor(() => expect(getQueryCancellationSignal(aRead.options)?.aborted).toBe(true));
    expect(getQueryCancellationSignal(bRead.options)?.aborted).toBe(false);
    aRead.finish();
    bRead.finish();
    await vi.waitFor(() => expect(b.ready).toBe(true));
    await new Promise<void>((resolve, reject) => {
      doc.submitOp([{ p: ['value'], na: 1 }], {}, (error) => (error ? reject(error) : resolve()));
    });
    await vi.waitFor(() => expect(b.results[0].data).toEqual({ value: 2 }));
    expect(streams()).toBe(1);
    b.destroy();
    await vi.waitFor(() => expect(streams()).toBe(0));
  });

  it('disconnects pending and ready scopes, then reconnects existing results with fresh ownership', async () => {
    const { db, connection, doc, connect, streams } = await setup();
    const ready = connection.createSubscribeQuery(collection, {}, {});
    (await db.take('initial')).finish();
    await vi.waitFor(() => expect(ready.ready).toBe(true));
    const oldAgent = connection.agent;
    const readySignal = getQueryCancellationSignal(
      oldAgent.subscribedQueries[queryId(ready)]!.options
    )!;
    const pending = connection.createSubscribeQuery(collection, {}, {});
    const read = await db.take('initial');
    connection.close();
    await vi.waitFor(() => expect(readySignal.aborted).toBe(true));
    expect(getQueryCancellationSignal(read.options)?.aborted).toBe(true);
    pending.destroy();
    read.finish();
    await vi.waitFor(() => expect(streams()).toBe(0));
    expect(Object.keys(oldAgent.subscribedQueries)).toEqual([]);
    db.delayPoll = true;
    await connect(connection);
    const reconnectRead = await db.take('poll');
    const newSignal = getQueryCancellationSignal(reconnectRead.options)!;
    expect(newSignal).not.toBe(readySignal);
    expect(newSignal.aborted).toBe(false);
    reconnectRead.finish();
    await vi.waitFor(() =>
      expect(connection.agent.subscribedQueries[queryId(ready)]).toBeDefined()
    );
    expect(ready.results).toEqual([doc]);
    db.delayPoll = false;
    await new Promise<void>((resolve, reject) => {
      doc.submitOp([{ p: ['value'], na: 1 }], {}, (error) => (error ? reject(error) : resolve()));
    });
    await vi.waitFor(() => expect(ready.results[0].data).toEqual({ value: 2 }));
  });

  it('preserves initial database errors, aborts their scope, and permits a healthy retry', async () => {
    const { db, connection, streams, replies } = await setup();
    const completed = vi.fn();
    const query = connection.createSubscribeQuery(collection, {}, {}, completed);
    const read = await db.take('initial');
    read.finish(Object.assign(new Error('denied'), { code: 'ERR_ACCESS_DENIED' }));
    await vi.waitFor(() => expect(completed).toHaveBeenCalled());
    expect(completed.mock.calls[0][0]).toMatchObject({
      code: 'ERR_ACCESS_DENIED',
      message: 'denied',
    });
    expect(getQueryCancellationSignal(read.options)?.aborted).toBe(true);
    expect(
      replies(connection.agent, queryId(query)).map(({ message }) => message.error?.code)
    ).toEqual(['ERR_ACCESS_DENIED']);
    expect(streams()).toBe(0);
    const retry = connection.createSubscribeQuery(collection, {}, {});
    (await db.take('initial')).finish();
    await vi.waitFor(() => expect(retry.ready).toBe(true));
    expect(retry.results.map((doc) => doc.id)).toEqual(['recOne']);
  });

  it('cleans reconnect fetchOps errors arriving before emitter creation without a late success', async () => {
    const { backend, db, connection, doc, streams, replies } = await setup();
    let resumeQuery: (() => void) | undefined;
    backend.use('query', (_context, next) => {
      resumeQuery = next;
    });
    db.delayOps = true;
    const completed = vi.fn();
    const query = connection.createSubscribeQuery(collection, {}, { results: [doc] }, completed);
    const ops = await db.take('ops');
    await vi.waitFor(() => expect(resumeQuery).toBeDefined());
    ops.finish(
      Object.assign(new Error('missing reconnect operations'), { code: 'ERR_MISSING_OPS' })
    );
    await vi.waitFor(() => expect(completed).toHaveBeenCalled());
    resumeQuery!();
    await flush();
    await flush();
    expect(connection.agent.subscribedQueries[queryId(query)]).toBeUndefined();
    expect(streams()).toBe(0);
    expect(
      replies(connection.agent, queryId(query)).map(({ message }) => message.error?.code)
    ).toEqual(['ERR_MISSING_OPS']);
  });

  it('cleans reconnect fetchOps errors after emitter installation and ignores its late poll', async () => {
    const { db, connection, doc, streams, replies } = await setup();
    db.delayOps = db.delayPoll = true;
    const completed = vi.fn();
    const query = connection.createSubscribeQuery(collection, {}, { results: [doc] }, completed);
    const ops = await db.take('ops');
    const poll = await db.take('poll');
    expect(connection.agent.subscribedQueries[queryId(query)]).toBeDefined();
    ops.finish(
      Object.assign(new Error('missing reconnect operations'), { code: 'ERR_MISSING_OPS' })
    );
    await vi.waitFor(() => expect(completed).toHaveBeenCalled());
    expect(getQueryCancellationSignal(poll.options)?.aborted).toBe(true);
    poll.finish();
    await flush();
    expect(connection.agent.subscribedQueries[queryId(query)]).toBeUndefined();
    expect(streams()).toBe(0);
    expect(
      replies(connection.agent, queryId(query)).map(({ message }) => message.error?.code)
    ).toEqual(['ERR_MISSING_OPS']);
  });

  it('finishes a canceled reconnect initial poll without a cancellation error reply', async () => {
    const { db, connection, doc, messages, streams, clientErrors } = await setup();
    db.delayPoll = true;
    const query = connection.createSubscribeQuery(collection, {}, { results: [doc] });
    const read = await db.take('poll');
    query.destroy();
    await vi.waitFor(() => expect(getQueryCancellationSignal(read.options)?.aborted).toBe(true));
    read.finish();
    await flush();
    expect(messages.filter(({ message }) => message.error)).toEqual([]);
    expect(clientErrors).toEqual([]);
    expect(streams()).toBe(0);
  });

  it('does not let an older completion replace a reused ID or reset its new client results', async () => {
    const { db, connection, streams, replies } = await setup();
    const old = connection.createSubscribeQuery(collection, {}, {});
    const oldRead = await db.take('initial');
    old.destroy();
    await vi.waitFor(() => expect(getQueryCancellationSignal(oldRead.options)?.aborted).toBe(true));
    connection.nextQueryId = queryId(old);
    const current = connection.createSubscribeQuery(collection, {}, {});
    (await db.take('initial')).finish();
    await vi.waitFor(() => expect(current.ready).toBe(true));
    const emitter = connection.agent.subscribedQueries[queryId(current)];
    oldRead.finish();
    await flush();
    await flush();
    expect(connection.agent.subscribedQueries[queryId(current)]).toBe(emitter);
    expect(getQueryCancellationSignal(emitter!.options)?.aborted).toBe(false);
    expect(current.results.map((doc) => doc.id)).toEqual(['recOne']);
    expect(replies(connection.agent, queryId(current))).toHaveLength(1);
    expect(streams()).toBe(1);
    current.destroy();
    await vi.waitFor(() => expect(streams()).toBe(0));
  });

  it('ignores a late canceled reply after a new same-ID emitter has become ready', async () => {
    const { backend, db, connection, streams } = await setup();
    let resumeReply: (() => void) | undefined;
    let hold = true;
    backend.use('reply', ({ request }, next) => {
      if (hold && request.a === 'qs') {
        resumeReply = next;
      } else {
        next();
      }
    });
    const old = connection.createSubscribeQuery(collection, {}, {});
    (await db.take('initial')).finish();
    await vi.waitFor(() => expect(resumeReply).toBeDefined());
    old.destroy();
    await vi.waitFor(() =>
      expect(connection.agent.subscribedQueries[queryId(old)]).toBeUndefined()
    );
    hold = false;
    connection.nextQueryId = queryId(old);
    const current = connection.createSubscribeQuery(collection, {}, {});
    (await db.take('initial')).finish();
    await vi.waitFor(() => expect(current.ready).toBe(true));
    const emitter = connection.agent.subscribedQueries[queryId(current)];
    resumeReply!();
    await flush();
    expect(connection.agent.subscribedQueries[queryId(current)]).toBe(emitter);
    expect(getQueryCancellationSignal(emitter!.options)?.aborted).toBe(false);
    expect(current.results.map((doc) => doc.id)).toEqual(['recOne']);
    expect(streams()).toBe(1);
  });

  it('does not enroll fetch queries or metadata subscriptions into qu cancellation', async () => {
    const { db, connection } = await setup();
    const fetch = connection.createFetchQuery(collection, {}, {});
    const fetchRead = await db.take('initial');
    expect(getQueryCancellationSignal(fetchRead.options)).toBeUndefined();
    fetch.destroy();
    fetchRead.finish();
    const metadata = connection.createSubscribeQuery('fld_tblCancellation', {}, {});
    const metadataRead = await db.take('initial');
    expect(getQueryCancellationSignal(metadataRead.options)).toBeUndefined();
    metadataRead.finish();
    await vi.waitFor(() => expect(metadata.ready).toBe(true));
    metadata.destroy();
  });
});
