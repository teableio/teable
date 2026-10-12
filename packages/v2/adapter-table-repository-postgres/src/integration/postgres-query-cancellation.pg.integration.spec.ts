import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { connect, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ConnectionOptions } from 'node:tls';
import { promisify } from 'node:util';
import {
  createV2PostgresDb,
  PostgresQueryCancelledError,
  runWithPostgresQueryCancellation,
  type IV2PostgresDbDependencies,
} from '@teable/v2-adapter-db-postgres-pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql, type Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Ordinary unit/PGlite runs must not start Docker or generate certificates.
const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
type PgPool = NonNullable<IV2PostgresDbDependencies['pool']>;
type PoolOptions = {
  connectionString: string;
  application_name?: string;
  max?: number;
  connectionTimeoutMillis?: number;
  ssl?: ConnectionOptions;
};
// Resolve pg from its owning workspace package, not a new dependency of this package.
const requirePg = createRequire(
  new URL('../../../adapter-db-postgres-pg/package.json', import.meta.url)
);
const { Pool } = requirePg('pg') as { Pool: new (options: PoolOptions) => PgPool };
const execFileAsync = promisify(execFile);
const watchTimeoutMs = 10_000;

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const observe = <T>(promise: Promise<T>) => {
  let settled = false;
  const result = promise
    .then<Outcome<T>, Outcome<T>>(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, error })
    )
    .then((outcome) => {
      settled = true;
      return outcome;
    });
  return { result, isSettled: () => settled };
};

// These bounds fail the test; they never set a product query deadline/statement_timeout.
const eventually = async <T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> => {
  const deadline = Date.now() + watchTimeoutMs;
  let value = await read();
  while (!ready(value)) {
    if (Date.now() >= deadline)
      throw new Error('Postgres observation barrier did not become ready');
    await delay(10);
    value = await read();
  }
  return value;
};

const withinWatch = async <T>(promise: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Postgres test barrier timed out')),
          watchTimeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const expectCancelled = (outcome: Outcome<unknown>, sqlState?: string) => {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error('Expected query cancellation');
  expect(outcome.error).toBeInstanceOf(PostgresQueryCancelledError);
  if (sqlState) {
    let cause: unknown = outcome.error;
    const seen = new Set<unknown>();
    let code: unknown;
    while (cause && typeof cause === 'object' && !seen.has(cause)) {
      seen.add(cause);
      if ('code' in cause && cause.code === sqlState) code = cause.code;
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    expect(code).toBe(sqlState);
  }
};

/** Transparent PG proxy: hold plaintext CancelRequests, or require TLS on every connection. */
const createCancelProxy = async (upstreamHost: string, upstreamPort: number, tlsOnly = false) => {
  const sockets = new Set<Socket>();
  const receivedCancel = deferred<{ pid: number; packet: Buffer; socket: Socket }>();
  const heldCancels: { packet: Buffer; socket: Socket }[] = [];
  const connections = { business: 0, control: 0 };
  const peakConnections = { business: 0, control: 0 };
  const countConnection = (socket: Socket, kind: keyof typeof connections) => {
    connections[kind] += 1;
    peakConnections[kind] = Math.max(peakConnections[kind], connections[kind]);
    socket.once('close', () => {
      connections[kind] -= 1;
    });
  };
  let cancellations = 0;
  let encryptedConnections = 0;
  const stoppedAccepting = deferred<void>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const forward = (socket: Socket, packet: Buffer) => {
    const upstream = track(connect({ host: upstreamHost, port: upstreamPort }));
    socket.once('close', () => upstream.destroy());
    upstream.once('error', () => socket.destroy());
    upstream.once('connect', () => {
      upstream.write(packet);
      socket.pipe(upstream);
      socket.resume();
    });
    upstream.pipe(socket);
    return upstream;
  };
  const server = createServer((socket) => {
    track(socket);
    let initial = Buffer.alloc(0);
    const receive = (chunk: Buffer) => {
      initial = Buffer.concat([initial, chunk]);
      if (initial.length < 8 || initial.length < initial.readInt32BE(0)) return;
      socket.pause();
      socket.off('data', receive);
      if (tlsOnly) {
        if (initial.readInt32BE(4) !== 80877103) {
          socket.destroy();
          return;
        }
        encryptedConnections += 1;
        forward(socket, initial);
        return;
      }
      if (initial.readInt32BE(4) === 80877102) {
        cancellations += 1;
        countConnection(socket, 'control');
        heldCancels.push({ packet: initial, socket });
        receivedCancel.resolve({ pid: initial.readInt32BE(8), packet: initial, socket });
      } else {
        countConnection(socket, 'business');
        forward(socket, initial);
      }
    };
    socket.on('data', receive);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing proxy TCP address');
  return {
    port: address.port,
    receivedCancel: receivedCancel.promise,
    cancellationCount: () => cancellations,
    sslConnectionCount: () => encryptedConnections,
    connections: () => ({ ...connections }),
    peakConnections: () => ({ ...peakConnections }),
    resetConnectionPeaks: () => {
      Object.assign(peakConnections, connections);
    },
    forwardCancel: async () => {
      const { socket, packet } = await receivedCancel.promise;
      const upstream = forward(socket, packet);
      await new Promise<void>((resolve) => upstream.once('close', resolve));
    },
    forwardHeldCancels: async () => {
      await Promise.all(
        heldCancels.splice(0).map(async ({ socket, packet }) => {
          const upstream = forward(socket, packet);
          await new Promise<void>((resolve) => upstream.once('close', resolve));
        })
      );
    },
    refuseNewConnections: () => {
      // close() stops accepting immediately but preserves the active business connection.
      server.close(() => stoppedAccepting.resolve());
    },
    resumeAccepting: async () => {
      await stoppedAccepting.promise;
      await new Promise<void>((resolve) => server.listen(address.port, '127.0.0.1', resolve));
    },
    close: async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
};

describePg('interactive query cancellation through the public pg adapter (real Postgres)', () => {
  let container: Awaited<ReturnType<PostgreSqlContainer['start']>> | undefined;
  let certificateDirectory: string | undefined;
  let ca: string;
  let observer: PgPool;
  let applicationName: string;
  let serial = 0;
  let cleaningUp = false;
  const unexpectedPoolErrors: Error[] = [];
  const pools: PgPool[] = [];
  const databases: Kysely<unknown>[] = [];
  const proxies: Awaited<ReturnType<typeof createCancelProxy>>[] = [];
  const pending: Promise<unknown>[] = [];

  const start = <T>(promise: Promise<T>) => {
    const operation = observe(promise);
    pending.push(operation.result);
    return operation;
  };
  const connectDb = async (options: Partial<PoolOptions> = {}) => {
    const connectionString = container!.getConnectionUri();
    const pool = new Pool({
      connectionString,
      max: 1,
      application_name: applicationName,
      ...options,
    });
    pool.on('error', (error) => {
      if (!cleaningUp) unexpectedPoolErrors.push(error);
    });
    pools.push(pool);
    const db = await createV2PostgresDb({ pg: { connectionString } }, { pool });
    databases.push(db);
    // Initialize Kysely outside the cancellation scope; no schema/setup can be canceled.
    await sql`select 1`.execute(db);
    return { db, pool };
  };
  const throughProxy = async (options: Partial<PoolOptions> = {}, tlsOnly = false) => {
    const proxy = await createCancelProxy(container!.getHost(), container!.getPort(), tlsOnly);
    proxies.push(proxy);
    const uri = new URL(container!.getConnectionUri());
    uri.hostname = '127.0.0.1';
    uri.port = String(proxy.port);
    return { ...(await connectDb({ ...options, connectionString: uri.toString() })), proxy };
  };
  const activity = async (query: string) => {
    const result = await observer.query<{ pid: number; state: string; wait_event: string | null }>(
      `select pid, state, wait_event from pg_stat_activity
       where application_name = $1 and query = $2 and state = 'active'`,
      [applicationName, query]
    );
    return result.rows;
  };
  const active = async (query: string, waitEvent: string) => {
    const rows = await eventually(
      () => activity(query),
      (rows) => rows.some((row) => row.wait_event === waitEvent)
    );
    return rows[0]!.pid;
  };
  const gone = async (query: string) => {
    await eventually(
      () => activity(query),
      (rows) => rows.length === 0
    );
  };
  const hold = (key: number) => observer.query('select pg_advisory_lock($1)', [key]);
  const unlock = (key: number) => observer.query('select pg_advisory_unlock($1)', [key]);
  const blockedSql = (key: number) =>
    `select pg_advisory_xact_lock(${key}), pg_backend_pid() as pid`;

  beforeAll(async () => {
    certificateDirectory = await mkdtemp(join(tmpdir(), 'teable-pg-cancellation-'));
    const file = (name: string) => join(certificateDirectory!, name);
    await execFileAsync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-subj',
      '/CN=Teable cancellation test CA',
      '-keyout',
      file('ca.key'),
      '-out',
      file('ca.crt'),
    ]);
    await execFileAsync('openssl', [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=query-cancellation.test',
      '-keyout',
      file('server.key'),
      '-out',
      file('server.csr'),
    ]);
    await writeFile(
      file('server.ext'),
      'subjectAltName=DNS:query-cancellation.test\nextendedKeyUsage=serverAuth\n'
    );
    await execFileAsync('openssl', [
      'x509',
      '-req',
      '-in',
      file('server.csr'),
      '-CA',
      file('ca.crt'),
      '-CAkey',
      file('ca.key'),
      '-CAcreateserial',
      '-days',
      '2',
      '-extfile',
      file('server.ext'),
      '-out',
      file('server.crt'),
    ]);
    ca = await readFile(file('ca.crt'), 'utf8');
    container = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    )
      .withCopyFilesToContainer([
        { source: file('server.key'), target: '/tmp/cancellation-server.key' },
        { source: file('server.crt'), target: '/tmp/cancellation-server.crt' },
      ])
      .withEntrypoint(['/bin/sh', '-c'])
      .withCommand([
        'chown postgres:postgres /tmp/cancellation-server.key && chmod 600 /tmp/cancellation-server.key && ' +
          'exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/cancellation-server.crt ' +
          '-c ssl_key_file=/tmp/cancellation-server.key',
      ])
      .start();
    observer = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
    await observer.query('create sequence cancellation_probe');
  });

  beforeEach(async () => {
    applicationName = `teable-cancellation-${++serial}`;
    cleaningUp = false;
    unexpectedPoolErrors.length = 0;
    await observer.query('alter sequence cancellation_probe restart with 1');
  });

  afterEach(async () => {
    // Failure cleanup only, never used as evidence of cancellation: unblock test SQL and
    // terminate only active leftovers; healthy idle pools close through their owner.
    cleaningUp = true;
    try {
      await observer?.query('select pg_advisory_unlock_all()');
      for (const proxy of proxies.splice(0)) await proxy.close();
      await observer?.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1 and state = 'active'",
        [applicationName]
      );
      await withinWatch(Promise.all(pending.splice(0)));
    } finally {
      try {
        await Promise.all(databases.splice(0).map((db) => db.destroy()));
      } finally {
        await Promise.all(pools.splice(0).map((pool) => pool.end()));
      }
    }
    expect(unexpectedPoolErrors).toEqual([]);
  });

  afterAll(async () => {
    try {
      await observer?.end();
    } finally {
      try {
        await container?.stop();
      } finally {
        if (certificateDirectory) await rm(certificateDirectory, { recursive: true, force: true });
      }
    }
  });

  it.each(['plaintext', 'verified TLS'] as const)(
    'physically cancels an active pg_sleep over %s',
    async (transport) => {
      const connection =
        transport === 'verified TLS'
          ? await throughProxy(
              { ssl: { ca, rejectUnauthorized: true, servername: 'query-cancellation.test' } },
              true
            )
          : { ...(await connectDb()), proxy: undefined };
      const { db, pool } = connection;
      if (transport === 'verified TLS') {
        const secure = await sql<{
          ssl: boolean;
        }>`select ssl from pg_stat_ssl where pid = pg_backend_pid()`.execute(db);
        expect(secure.rows[0]!.ssl).toBe(true);
      }
      const controller = new AbortController();
      const statement = `select pg_sleep(60) /* ${applicationName} */`;
      const request = start(
        runWithPostgresQueryCancellation(controller.signal, () => sql.raw(statement).execute(db))
      );
      const oldPid = await active(statement, 'PgSleep');
      controller.abort();
      expectCancelled(await withinWatch(request.result), '57014');
      await gone(statement);
      await eventually(
        async () => pool.totalCount,
        (count) => count === 0
      );
      // An unencrypted cancel cannot pass this proxy. Both connections reach the real TLS PG server.
      if (connection.proxy) expect(connection.proxy.sslConnectionCount()).toBe(2);
      const next = await sql<{
        pid: number;
        timeout: string;
      }>`select pg_backend_pid() as pid, current_setting('statement_timeout') as timeout`.execute(
        db
      );
      expect(next.rows[0]!.pid).not.toBe(oldPid);
      expect(next.rows[0]!.timeout).toBe('0');
    }
  );

  it('keeps a completed original lease quarantined until the delayed CancelRequest closes', async () => {
    const { db, pool, proxy } = await throughProxy();
    const controller = new AbortController();
    const key = 101;
    const nextKey = 102;
    await hold(key);
    await hold(nextKey);
    const statement = blockedSql(key);
    const request = start(
      runWithPostgresQueryCancellation(controller.signal, () => sql.raw(statement).execute(db))
    );
    const oldPid = await active(statement, 'advisory');
    controller.abort();
    expect((await withinWatch(proxy.receivedCancel)).pid).toBe(oldPid);
    // The original SQL now completes normally while its cancel packet is still held in the proxy.
    await unlock(key);
    await eventually(
      async () =>
        (
          await observer.query<{ state: string }>(
            'select state from pg_stat_activity where pid = $1',
            [oldPid]
          )
        ).rows,
      (rows) => rows[0]?.state === 'idle'
    );
    expect(pool.idleCount).toBe(0);
    const next = start(sql.raw<{ pid: number }>(blockedSql(nextKey)).execute(db));
    await eventually(
      async () => pool.waitingCount,
      (count) => count === 1
    );
    expect(await activity(blockedSql(nextKey))).toEqual([]);
    await withinWatch(proxy.forwardCancel());
    expectCancelled(await withinWatch(request.result));
    const newPid = await active(blockedSql(nextKey), 'advisory');
    expect(newPid).not.toBe(oldPid);
    await unlock(nextKey);
    const result = await withinWatch(next.result);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rows[0]!.pid).toBe(newPid);
  });

  it('does not release a still-active lease when the cancel control connection is refused', async () => {
    const { db, pool, proxy } = await throughProxy();
    const key = 103;
    await hold(key);
    const statement = blockedSql(key);
    const controller = new AbortController();
    const request = start(
      runWithPostgresQueryCancellation(controller.signal, () => sql.raw(statement).execute(db))
    );
    const oldPid = await active(statement, 'advisory');
    proxy.refuseNewConnections();
    const refusal = await new Promise<unknown>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port: proxy.port });
      socket.once('error', resolve);
      socket.once('connect', () => {
        socket.destroy();
        resolve(undefined);
      });
    });
    expect(refusal).toMatchObject({ code: 'ECONNREFUSED' });
    controller.abort();
    // A queued consumer must remain blocked while the original backend still holds its lease.
    const next = start(sql`select 42 as answer`.execute(db));
    await eventually(
      async () => pool.waitingCount,
      (count) => count === 1
    );
    expect(await activity(statement)).toEqual([
      { pid: oldPid, state: 'active', wait_event: 'advisory' },
    ]);
    expect(next.isSettled()).toBe(false);
    expect(pool.idleCount).toBe(0);
    expect(pool.totalCount).toBe(1);
    await unlock(key);
    expectCancelled(await withinWatch(request.result));
    const result = await withinWatch(next.result);
    // The listener is intentionally still down: the queued checkout only attempts to connect
    // after the original query finishes, and therefore receives the expected refusal now.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'ECONNREFUSED' });
    await withinWatch(proxy.resumeAccepting());
    expect((await sql`select 42 as answer`.execute(db)).rows).toEqual([{ answer: 42 }]);
    const pid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db)).rows[0]!
      .pid;
    expect(pid).not.toBe(oldPid);
  });

  it('releases a late max=1 checkout after a queued abort without executing its SQL', async () => {
    const { db, pool } = await connectDb();
    const holder = await pool.connect();
    const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
      .rows[0]!.pid;
    const controller = new AbortController();
    const waiter = start(
      runWithPostgresQueryCancellation(controller.signal, () =>
        sql`select nextval('cancellation_probe')`.execute(db)
      )
    );
    try {
      await eventually(
        async () => pool.waitingCount,
        (count) => count === 1
      );
      controller.abort();
      expectCancelled(await withinWatch(waiter.result));
      // pg-pool cannot remove a public connect waiter immediately. Its current owner is unaffected.
      expect(
        (await holder.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid
      ).toBe(holderPid);
    } finally {
      holder.release();
    }
    await eventually(
      async () => ({ waiting: pool.waitingCount, idle: pool.idleCount }),
      (counts) => counts.waiting === 0 && counts.idle === 1
    );
    expect((await observer.query('select is_called from cancellation_probe')).rows).toEqual([
      { is_called: false },
    ]);
    expect(
      (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db)).rows[0]!.pid
    ).toBe(holderPid);
  });

  it('ignores an old signal after normal release while a new query uses the same backend', async () => {
    const { db, proxy } = await throughProxy();
    const controller = new AbortController();
    const first = await runWithPostgresQueryCancellation(controller.signal, () =>
      sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(db)
    );
    const key = 104;
    await hold(key);
    const statement = blockedSql(key);
    const next = start(sql.raw<{ pid: number }>(statement).execute(db));
    expect(await active(statement, 'advisory')).toBe(first.rows[0]!.pid);
    controller.abort();
    // Observer round-trip is a state barrier; completing the blocked query proves it survived the old signal.
    expect(await activity(statement)).toEqual([
      { pid: first.rows[0]!.pid, state: 'active', wait_event: 'advisory' },
    ]);
    await unlock(key);
    const result = await withinWatch(next.result);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rows[0]!.pid).toBe(first.rows[0]!.pid);
    expect(proxy.cancellationCount()).toBe(0);
  });

  it('cancels both active leases in a parallel records/count-shaped scope', async () => {
    const { db, pool } = await connectDb({ max: 2 });
    const controller = new AbortController();
    const statements = [0, 1].map(
      (index) => `select pg_sleep(60) /* ${applicationName}-${index} */`
    );
    const requests = await runWithPostgresQueryCancellation(controller.signal, async () =>
      statements.map((statement) => start(sql.raw(statement).execute(db)))
    );
    const pids = await Promise.all(statements.map((statement) => active(statement, 'PgSleep')));
    expect(pids[0]).not.toBe(pids[1]);
    controller.abort();
    const outcomes = await withinWatch(Promise.all(requests.map((request) => request.result)));
    for (const outcome of outcomes) expectCancelled(outcome, '57014');
    await Promise.all(statements.map(gone));
    await eventually(
      async () => pool.totalCount,
      (count) => count === 0
    );
    expect((await sql`select 42 as answer`.execute(db)).rows).toEqual([{ answer: 42 }]);
  });

  it.each([5, 20])(
    'recovers a max=%i pool after repeated active and queued cancellation bursts',
    async (max) => {
      const { db, pool, proxy } = await throughProxy({ max });
      let peakPoolConnections = pool.totalCount;
      pool.on('connect', () => {
        peakPoolConnections = Math.max(peakPoolConnections, pool.totalCount);
      });
      const activeCount = max - 1;
      const queuedCount = max * 2;
      for (let burst = 0; burst < 3; burst += 1) {
        proxy.resetConnectionPeaks();
        const key = 200 + burst * 2;
        const neighborKey = key + 1;
        await hold(key);
        await hold(neighborKey);
        const statement = blockedSql(key);
        const controllers = Array.from({ length: activeCount }, () => new AbortController());
        const requests = controllers.map((controller) =>
          start(
            runWithPostgresQueryCancellation(controller.signal, () =>
              sql.raw(statement).execute(db)
            )
          )
        );
        const neighborStatement = `${blockedSql(neighborKey)}, 42 as answer`;
        const neighbor = start(
          sql.raw<{ pid: number; answer: number }>(neighborStatement).execute(db)
        );
        await eventually(
          () => activity(statement),
          (rows) =>
            rows.length === activeCount && rows.every((row) => row.wait_event === 'advisory')
        );
        const neighborPid = await active(neighborStatement, 'advisory');
        expect(pool.totalCount).toBe(max);
        const queuedControllers = Array.from({ length: queuedCount }, () => new AbortController());
        const queued = queuedControllers.map((controller) =>
          start(
            runWithPostgresQueryCancellation(controller.signal, () =>
              sql`select nextval('cancellation_probe')`.execute(db)
            )
          )
        );
        const waitingAtPeak = await eventually(
          async () => pool.waitingCount,
          (count) => count === queuedCount
        );
        for (const controller of queuedControllers) controller.abort();
        for (const outcome of await withinWatch(Promise.all(queued.map((item) => item.result)))) {
          expectCancelled(outcome);
        }
        const cancelStarted = performance.now();
        for (const controller of controllers) controller.abort();
        await eventually(
          async () => proxy.connections(),
          (counts) => counts.control === activeCount
        );
        expect(proxy.connections().business).toBe(max);
        expect(pool.totalCount).toBe(max);
        expect(pool.idleCount).toBe(0);
        await withinWatch(proxy.forwardHeldCancels());
        for (const outcome of await withinWatch(Promise.all(requests.map((item) => item.result)))) {
          expectCancelled(outcome, '57014');
        }
        await gone(statement);
        const activeCancellationMs = performance.now() - cancelStarted;
        // The uncanceled neighbor still owns its original lease and must survive every cancel packet.
        expect(await activity(neighborStatement)).toEqual([
          { pid: neighborPid, state: 'active', wait_event: 'advisory' },
        ]);
        await unlock(neighborKey);
        const neighborResult = await withinWatch(neighbor.result);
        expect(neighborResult.ok).toBe(true);
        if (neighborResult.ok) {
          expect(neighborResult.value.rows[0]).toMatchObject({ pid: neighborPid, answer: 42 });
        }
        await unlock(key);
        const freshStarted = performance.now();
        const fresh = await withinWatch(start(sql`select 43 as answer`.execute(db)).result);
        expect(fresh.ok).toBe(true);
        if (fresh.ok) expect(fresh.value.rows).toEqual([{ answer: 43 }]);
        const freshReadMs = performance.now() - freshStarted;
        const recovered = await eventually(
          async () => ({
            waiting: pool.waitingCount,
            idle: pool.idleCount,
            total: pool.totalCount,
          }),
          (counts) => counts.waiting === 0 && counts.idle === counts.total
        );
        await eventually(
          async () => proxy.connections(),
          (counts) => counts.control === 0 && counts.business === pool.totalCount
        );
        // nextval is nontransactional: even transient execution by an abandoned checkout is visible.
        expect((await observer.query('select is_called from cancellation_probe')).rows).toEqual([
          { is_called: false },
        ]);
        expect(peakPoolConnections).toBeLessThanOrEqual(max);
        console.info(
          JSON.stringify({
            scenario: 'active-and-queued-cancellation-burst',
            poolSize: max,
            burst,
            activeCancellations: activeCount,
            queuedCancellations: queuedCount,
            peakPoolConnections,
            peakBusinessConnections: proxy.peakConnections().business,
            peakControlConnections: proxy.peakConnections().control,
            waitingAtPeak,
            waitingRecovered: recovered.waiting,
            activeCancellationMs,
            freshReadMs,
            recoveryMs: performance.now() - cancelStarted,
          })
        );
      }
    }
  );

  it.each([5, 20])(
    'quarantines and recovers all max=%i slots across repeated delayed-control bursts',
    async (max) => {
      const { db, pool, proxy } = await throughProxy({ max });
      let peakPoolConnections = pool.totalCount;
      pool.on('connect', () => {
        peakPoolConnections = Math.max(peakPoolConnections, pool.totalCount);
      });
      for (let burst = 0; burst < 2; burst += 1) {
        proxy.resetConnectionPeaks();
        const key = 300 + burst * 2;
        const nextKey = key + 1;
        await hold(key);
        await hold(nextKey);
        const statement = blockedSql(key);
        const controllers = Array.from({ length: max }, () => new AbortController());
        const requests = controllers.map((controller) =>
          start(
            runWithPostgresQueryCancellation(controller.signal, () =>
              sql.raw(statement).execute(db)
            )
          )
        );
        const originals = await eventually(
          () => activity(statement),
          (rows) => rows.length === max && rows.every((row) => row.wait_event === 'advisory')
        );
        const oldPids = originals.map((row) => row.pid);
        for (const controller of controllers) controller.abort();
        await eventually(
          async () => proxy.connections(),
          (counts) => counts.control === max
        );
        // Every original finishes, but no held CancelRequest has reached PostgreSQL yet.
        await unlock(key);
        await eventually(
          async () =>
            (
              await observer.query<{ pid: number; state: string }>(
                'select pid, state from pg_stat_activity where pid = any($1::int[])',
                [oldPids]
              )
            ).rows,
          (rows) => rows.length === max && rows.every((row) => row.state === 'idle')
        );
        const queuedCount = max * 2;
        const queuedControllers = Array.from({ length: queuedCount }, () => new AbortController());
        const queued = queuedControllers.map((controller) =>
          start(
            runWithPostgresQueryCancellation(controller.signal, () =>
              sql`select nextval('cancellation_probe')`.execute(db)
            )
          )
        );
        const nextStatement = `${blockedSql(nextKey)}, 42 as answer`;
        const neighbors = Array.from({ length: max }, () =>
          start(sql.raw<{ pid: number; answer: number }>(nextStatement).execute(db))
        );
        const waitingAtPeak = await eventually(
          async () => pool.waitingCount,
          (count) => count === queuedCount + max
        );
        for (const controller of queuedControllers) controller.abort();
        for (const outcome of await withinWatch(Promise.all(queued.map((item) => item.result)))) {
          expectCancelled(outcome);
        }
        expect(pool.totalCount).toBe(max);
        expect(pool.idleCount).toBe(0);
        for (const outcome of await withinWatch(Promise.all(requests.map((item) => item.result)))) {
          expectCancelled(outcome);
        }
        expect(neighbors.every((request) => !request.isSettled())).toBe(true);
        expect(await activity(nextStatement)).toEqual([]);
        expect((await observer.query('select is_called from cancellation_probe')).rows).toEqual([
          { is_called: false },
        ]);
        const recoveryStarted = performance.now();
        await withinWatch(proxy.forwardHeldCancels());
        const nextBackends = await eventually(
          () => activity(nextStatement),
          (rows) => rows.length === max && rows.every((row) => row.wait_event === 'advisory')
        );
        expect(nextBackends.every((row) => !oldPids.includes(row.pid))).toBe(true);
        expect(pool.waitingCount).toBe(0);
        await unlock(nextKey);
        const outcomes = await withinWatch(Promise.all(neighbors.map((request) => request.result)));
        for (const outcome of outcomes) {
          expect(outcome.ok).toBe(true);
          if (outcome.ok) {
            expect(outcome.value.rows[0]!.answer).toBe(42);
            expect(oldPids).not.toContain(outcome.value.rows[0]!.pid);
          }
        }
        const freshStarted = performance.now();
        const fresh = await withinWatch(start(sql`select 43 as answer`.execute(db)).result);
        expect(fresh.ok).toBe(true);
        if (fresh.ok) expect(fresh.value.rows).toEqual([{ answer: 43 }]);
        const freshReadMs = performance.now() - freshStarted;
        const recovered = await eventually(
          async () => ({
            waiting: pool.waitingCount,
            idle: pool.idleCount,
            total: pool.totalCount,
          }),
          (counts) => counts.waiting === 0 && counts.idle === max && counts.total === max
        );
        await eventually(
          async () => proxy.connections(),
          (counts) => counts.control === 0 && counts.business === max
        );
        expect((await observer.query('select is_called from cancellation_probe')).rows).toEqual([
          { is_called: false },
        ]);
        expect(peakPoolConnections).toBeLessThanOrEqual(max);
        console.info(
          JSON.stringify({
            scenario: 'completed-sql-delayed-controls',
            poolSize: max,
            burst,
            activeCancellations: max,
            queuedCancellations: queuedCount,
            peakPoolConnections,
            peakBusinessConnections: proxy.peakConnections().business,
            peakControlConnections: proxy.peakConnections().control,
            waitingAtPeak,
            waitingRecovered: recovered.waiting,
            freshReadMs,
            recoveryMs: performance.now() - recoveryStarted,
          })
        );
      }
    }
  );

  it('does not acquire or submit the first SQL for an already-aborted scope', async () => {
    const { db, pool } = await connectDb();
    const controller = new AbortController();
    controller.abort();
    let acquired = 0;
    const onAcquire = () => {
      acquired += 1;
    };
    pool.on('acquire', onAcquire);
    try {
      const result = start(
        runWithPostgresQueryCancellation(controller.signal, () =>
          sql`select nextval('cancellation_probe')`.execute(db)
        )
      );
      expectCancelled(await withinWatch(result.result));
      expect(acquired).toBe(0);
      expect((await observer.query('select is_called from cancellation_probe')).rows).toEqual([
        { is_called: false },
      ]);
    } finally {
      pool.off('acquire', onAcquire);
    }
  });

  it('clears a nested undefined scope and restores the aborted outer scope', async () => {
    const { db } = await connectDb();
    const controller = new AbortController();
    const key = 105;
    await hold(key);
    const statement = blockedSql(key);
    let innerPid: number | undefined;
    const outer = start(
      runWithPostgresQueryCancellation(controller.signal, async () => {
        const result = await runWithPostgresQueryCancellation(undefined, async () => {
          return sql.raw<{ pid: number }>(statement).execute(db);
        });
        innerPid = result.rows[0]!.pid;
        return sql`select nextval('cancellation_probe')`.execute(db);
      })
    );
    const activePid = await active(statement, 'advisory');
    controller.abort();
    await unlock(key);
    expectCancelled(await withinWatch(outer.result));
    expect(innerPid).toBe(activePid);
    expect((await observer.query('select is_called from cancellation_probe')).rows).toEqual([
      { is_called: false },
    ]);
    expect((await sql`select 42 as answer`.execute(db)).rows).toEqual([{ answer: 42 }]);
  });

  it('preserves cancellation when a repository drops the SQL error cause', async () => {
    const { db } = await connectDb();
    const controller = new AbortController();
    const statement = `select pg_sleep(60) /* wrapped-${applicationName} */`;
    const request = start(
      runWithPostgresQueryCancellation(controller.signal, async () => {
        try {
          return await sql.raw(statement).execute(db);
        } catch {
          return { error: { code: 'unexpected', message: 'Repository query failed' } };
        }
      })
    );
    await active(statement, 'PgSleep');
    controller.abort();
    expectCancelled(await withinWatch(request.result), '57014');
    await gone(statement);
  });

  it('preserves borrowed pool ownership across cancellation and database destruction', async () => {
    const { db, pool } = await connectDb();
    const controller = new AbortController();
    const statement = `select pg_sleep(60) /* borrowed-${applicationName} */`;
    const request = start(
      runWithPostgresQueryCancellation(controller.signal, () => sql.raw(statement).execute(db))
    );
    await active(statement, 'PgSleep');
    controller.abort();
    expectCancelled(await withinWatch(request.result), '57014');
    await gone(statement);
    await db.destroy();
    expect((await pool.query('select 42 as answer')).rows).toEqual([{ answer: 42 }]);
    const other = await createV2PostgresDb(
      { pg: { connectionString: container!.getConnectionUri() } },
      { pool }
    );
    databases.push(other);
    expect((await sql`select 43 as answer`.execute(other)).rows).toEqual([{ answer: 43 }]);
  });
});
