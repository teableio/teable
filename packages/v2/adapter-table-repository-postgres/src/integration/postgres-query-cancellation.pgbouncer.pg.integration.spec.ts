import { createRequire } from 'node:module';
import { connect, createServer, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createV2PostgresDb,
  PostgresQueryCancelledError,
  runWithPostgresQueryCancellation,
  type IV2PostgresDbDependencies,
} from '@teable/v2-adapter-db-postgres-pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql, type Kysely } from 'kysely';
import { GenericContainer, Network, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Default unit/PGlite runs never start Docker. These fixtures do not establish production topology support.
const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const poolerImage =
  process.env.TEABLE_V2_TEST_PGBOUNCER_IMAGE ??
  'edoburu/pgbouncer:v1.25.2-p0@sha256:7d7a27d9e90985cab5cf42256f5c13a3120baa4b055b69df37beb272b89b2340';
const poolModes = ['session', 'transaction'] as const;
type PoolMode = (typeof poolModes)[number];
type PgPool = NonNullable<IV2PostgresDbDependencies['pool']>;
const requirePg = createRequire(
  new URL('../../../adapter-db-postgres-pg/package.json', import.meta.url)
);
const { Pool } = requirePg('pg') as {
  Pool: new (options: {
    connectionString: string;
    application_name?: string;
    max: number;
  }) => PgPool;
};
const watchTimeoutMs = 10_000;

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const observe = <T>(promise: Promise<T>) =>
  promise.then<Outcome<T>, Outcome<T>>(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error })
  );

// Observation bounds fail the fixture; they do not impose product SQL deadlines.
const eventually = async <T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> => {
  const deadline = Date.now() + watchTimeoutMs;
  let value = await read();
  while (!ready(value)) {
    if (Date.now() >= deadline)
      throw new Error('PgBouncer observation barrier did not become ready');
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
          () => reject(new Error('PgBouncer test barrier timed out')),
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

// A delaying TCP shim in FRONT OF real PgBouncer, not a pooler replacement. Business traffic
// is untouched; one plaintext CancelRequest waits until a different frontend owns the backend.
const delayCancelToPooler = async (host: string, port: number) => {
  const sockets = new Set<Socket>();
  const receivedCancel = deferred<{ socket: Socket; packet: Buffer }>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const forward = (socket: Socket, packet: Buffer) => {
    const upstream = track(connect({ host, port }));
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
      if (initial.readInt32BE(4) === 80877102) {
        receivedCancel.resolve({ socket, packet: initial });
      } else {
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
  if (!address || typeof address === 'string') throw new Error('Missing cancellation shim address');
  return {
    port: address.port,
    receivedCancel: receivedCancel.promise,
    forwardCancel: async () => {
      const { socket, packet } = await receivedCancel.promise;
      const upstream = forward(socket, packet);
      await new Promise<void>((resolve) => upstream.once('close', resolve));
    },
    close: async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
};

describePg('public pg adapter cancellation through real PgBouncer', () => {
  let network: Awaited<ReturnType<Network['start']>> | undefined;
  let postgres: Awaited<ReturnType<PostgreSqlContainer['start']>> | undefined;
  let observer: PgPool | undefined;
  let applicationName: string;
  let serial = 0;
  let cleaningUp = false;
  const unexpectedPoolErrors: Error[] = [];
  const pools = new Set<PgPool>();
  const databases: Kysely<unknown>[] = [];
  const poolers: Awaited<ReturnType<GenericContainer['start']>>[] = [];
  const shims: Awaited<ReturnType<typeof delayCancelToPooler>>[] = [];
  const pending: Promise<unknown>[] = [];

  const start = <T>(promise: Promise<T>) => {
    const result = observe(promise);
    pending.push(result);
    return result;
  };
  const newPool = (connectionString: string) => {
    const pool = new Pool({ connectionString, application_name: applicationName, max: 1 });
    pool.on('error', (error) => {
      if (!cleaningUp) unexpectedPoolErrors.push(error);
    });
    pools.add(pool);
    return pool;
  };
  const connectDb = async (connectionString: string) => {
    const pool = newPool(connectionString);
    const db = await createV2PostgresDb({ pg: { connectionString } }, { pool });
    databases.push(db);
    await sql`select 1`.execute(db);
    return { db, pool };
  };
  const startPooler = async (mode: PoolMode, size: number) => {
    const pooler = await new GenericContainer(poolerImage)
      .withNetwork(network!)
      .withEnvironment({
        DB_HOST: 'cancellation-postgres',
        DB_PORT: '5432',
        DB_NAME: postgres!.getDatabase(),
        DB_USER: postgres!.getUsername(),
        DB_PASSWORD: postgres!.getPassword(),
        AUTH_TYPE: 'scram-sha-256',
        ADMIN_USERS: postgres!.getUsername(),
        POOL_MODE: mode,
        DEFAULT_POOL_SIZE: String(size),
        RESERVE_POOL_SIZE: '0',
        MAX_CLIENT_CONN: '20',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/process up:/))
      .start();
    poolers.push(pooler);
    const uri = new URL(postgres!.getConnectionUri());
    uri.hostname = pooler.getHost();
    uri.port = String(pooler.getMappedPort(5432));
    const connectionString = uri.toString();
    uri.pathname = '/pgbouncer';
    const admin = newPool(uri.toString());
    const version = (await admin.query<{ version: string }>('SHOW VERSION')).rows[0]!.version;
    expect(version).toMatch(/^PgBouncer /);
    const config = await admin.query<{ key: string; value: string }>('SHOW CONFIG');
    expect(config.rows.find((row) => row.key === 'pool_mode')?.value).toBe(mode);
    expect(config.rows.find((row) => row.key === 'default_pool_size')?.value).toBe(String(size));
    return { pooler, connectionString, version };
  };
  const activity = async (query: string) =>
    (
      await observer!.query<{ pid: number; wait_event: string | null }>(
        `select pid, wait_event from pg_stat_activity
         where datname = $1 and application_name = $2 and query = $3 and state = 'active'`,
        [postgres!.getDatabase(), applicationName, query]
      )
    ).rows;
  const active = async (query: string) => {
    const rows = await eventually(
      () => activity(query),
      (rows) => rows.some((row) => row.wait_event === 'advisory')
    );
    return rows.find((row) => row.wait_event === 'advisory')!.pid;
  };
  const gone = (query: string) =>
    eventually(
      () => activity(query),
      (rows) => rows.length === 0
    );
  const hold = (key: number) => observer!.query('select pg_advisory_lock($1)', [key]);
  const unlock = (key: number) => observer!.query('select pg_advisory_unlock($1)', [key]);
  const blockedSql = (key: number, answer: number) =>
    `select pg_advisory_xact_lock(${key}), pg_backend_pid() as pid, ${answer} as answer /* ${applicationName} */`;
  const report = (version: string, mode: PoolMode, scenario: string) => {
    console.info(`[pgbouncer-cancellation] ${version}; pool_mode=${mode}; ${scenario}=passed`);
  };

  beforeAll(async () => {
    network = await new Network().start();
    postgres = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    )
      .withNetwork(network)
      .withNetworkAliases('cancellation-postgres')
      .withDatabase('cancellation_fixture')
      .withUsername('teable')
      .withPassword('fixture-password')
      .start();
    // Advisory locks and activity inspection use one dedicated connection directly to fixture PG.
    observer = new Pool({ connectionString: postgres.getConnectionUri(), max: 1 });
  });
  beforeEach(() => {
    applicationName = `teable-pgbouncer-cancellation-${++serial}`;
    cleaningUp = false;
    unexpectedPoolErrors.length = 0;
  });
  afterEach(async () => {
    cleaningUp = true;
    try {
      await observer?.query('select pg_advisory_unlock_all()');
      await Promise.all(shims.splice(0).map((shim) => shim.close()));
      // Failure cleanup only, never cancellation evidence; no non-fixture database is reachable.
      await observer?.query(
        `select pg_terminate_backend(pid) from pg_stat_activity
         where datname = $1 and application_name = $2 and state = 'active'`,
        [postgres?.getDatabase(), applicationName]
      );
      await withinWatch(Promise.all(pending.splice(0)));
    } finally {
      try {
        await Promise.all(databases.splice(0).map((db) => db.destroy()));
      } finally {
        try {
          const closing = [...pools];
          pools.clear();
          await Promise.all(closing.map((pool) => pool.end()));
        } finally {
          await Promise.all(poolers.splice(0).map((pooler) => pooler.stop()));
        }
      }
    }
    expect(unexpectedPoolErrors).toEqual([]);
  });
  afterAll(async () => {
    try {
      await observer?.end();
    } finally {
      try {
        await postgres?.stop();
      } finally {
        await network?.stop();
      }
    }
  });

  it.each(poolModes)(
    'physically cancels only the abandoned read in %s mode and recovers',
    async (mode) => {
      const { connectionString, version } = await startPooler(mode, 2);
      const abandoned = await connectDb(connectionString);
      const unrelated = await connectDb(connectionString);
      const controller = new AbortController();
      await hold(201);
      await hold(202);
      const cancelledSql = blockedSql(201, 41);
      const unrelatedSql = blockedSql(202, 42);
      const request = start(
        runWithPostgresQueryCancellation(controller.signal, () =>
          sql.raw(cancelledSql).execute(abandoned.db)
        )
      );
      const cancelledPid = await active(cancelledSql);
      const survivor = start(
        sql.raw<{ pid: number; answer: number }>(unrelatedSql).execute(unrelated.db)
      );
      const survivorPid = await active(unrelatedSql);
      expect(survivorPid).not.toBe(cancelledPid);
      controller.abort();
      // The original advisory lock is still held: normal completion cannot impersonate cancellation.
      expectCancelled(await withinWatch(request), '57014');
      await gone(cancelledSql);
      await eventually(
        async () => abandoned.pool.totalCount,
        (count) => count === 0
      );
      expect(await activity(unrelatedSql)).toEqual([{ pid: survivorPid, wait_event: 'advisory' }]);
      await unlock(202);
      const result = await withinWatch(survivor);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.rows[0]).toMatchObject({ pid: survivorPid, answer: 42 });
      // The adapter retires its frontend, not necessarily PgBouncer's reusable physical PG backend.
      expect((await sql`select 43 as answer`.execute(abandoned.db)).rows).toEqual([{ answer: 43 }]);
      await unlock(201);
      report(version, mode, 'sqlstate57014+unrelated-isolation+fresh-consumer');
    }
  );

  it.each(poolModes)(
    'ignores an after-completion abort after another frontend reuses the backend in %s mode',
    async (mode) => {
      const { connectionString, version } = await startPooler(mode, 1);
      const original = await connectDb(connectionString);
      const controller = new AbortController();
      const first = await runWithPostgresQueryCancellation(controller.signal, () =>
        sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(original.db)
      );
      // Session pooling releases its server only when the first frontend disconnects. Transaction
      // pooling must reuse it while the original frontend remains open (and could send a stale cancel).
      if (mode === 'session') {
        await original.pool.end();
        pools.delete(original.pool);
      }
      const next = await connectDb(connectionString);
      await hold(203);
      const statement = blockedSql(203, 44);
      const survivor = start(sql.raw<{ pid: number; answer: number }>(statement).execute(next.db));
      expect(await active(statement)).toBe(first.rows[0]!.pid);
      controller.abort();
      expect(await activity(statement)).toEqual([
        { pid: first.rows[0]!.pid, wait_event: 'advisory' },
      ]);
      await unlock(203);
      const result = await withinWatch(survivor);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.value.rows[0]).toMatchObject({ pid: first.rows[0]!.pid, answer: 44 });
      expect((await sql`select 45 as answer`.execute(next.db)).rows).toEqual([{ answer: 45 }]);
      report(version, mode, 'after-completion-abort+same-backend-other-frontend');
    }
  );

  it('isolates a delayed CancelRequest after real transaction pooling reassigns the backend', async () => {
    const mode = 'transaction';
    const { pooler, connectionString, version } = await startPooler(mode, 1);
    const shim = await delayCancelToPooler(pooler.getHost(), pooler.getMappedPort(5432));
    shims.push(shim);
    const uri = new URL(connectionString);
    uri.hostname = '127.0.0.1';
    uri.port = String(shim.port);
    const original = await connectDb(uri.toString());
    const controller = new AbortController();
    await hold(204);
    await hold(205);
    const statement = blockedSql(204, 46);
    const request = start(
      runWithPostgresQueryCancellation(controller.signal, () =>
        sql.raw(statement).execute(original.db)
      )
    );
    const originalPid = await active(statement);
    controller.abort();
    await withinWatch(shim.receivedCancel);
    // Complete the original SQL before the control packet reaches PgBouncer. Its frontend is
    // quarantined by the adapter, but transaction pooling can already lend out its physical backend.
    await unlock(204);
    expectCancelled(await withinWatch(request));
    await gone(statement);
    expect(original.pool.idleCount).toBe(0);
    expect(original.pool.totalCount).toBe(1);
    const next = await connectDb(connectionString);
    const nextStatement = blockedSql(205, 47);
    const survivor = start(
      sql.raw<{ pid: number; answer: number }>(nextStatement).execute(next.db)
    );
    expect(await active(nextStatement)).toBe(originalPid);
    await withinWatch(shim.forwardCancel());
    await eventually(
      async () => original.pool.totalCount,
      (count) => count === 0
    );
    expect(await activity(nextStatement)).toEqual([{ pid: originalPid, wait_event: 'advisory' }]);
    await unlock(205);
    const result = await withinWatch(survivor);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rows[0]).toMatchObject({ pid: originalPid, answer: 47 });
    expect((await sql`select 48 as answer`.execute(original.db)).rows).toEqual([{ answer: 48 }]);
    report(version, mode, 'delaying-shim+late-cancel+same-backend-other-frontend');
  });
});
