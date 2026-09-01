/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared-app-per-worker support for the e2e suites.
 *
 * The e2e configs run with `isolate: false` so each vitest worker process executes
 * many spec files sequentially. Booting the full Nest AppModule for every file used
 * to dominate CI time (~24s per file), so the first boot in a worker is cached here
 * and reused by later files. Correctness guards:
 *
 * - Spec files that mutate process.env BEFORE calling initApp (boot-time config)
 *   automatically fall back to a private, really-closable app: initApp compares the
 *   current env against the worker's baseline fingerprint and boots fresh on any
 *   difference. The custom e2e runner restores the baseline env after every file.
 * - `close()` is a no-op for every app while sharing is enabled. Nest testing
 *   modules in one worker can share process-global Prisma/Knex resources, so
 *   closing a private app would poison the worker's canonical app. The process
 *   reclaims both shared and private apps at worker teardown.
 *
 * Parallel file execution is made safe by giving every worker its own database,
 * cloned from the freshly seeded template DB in globalSetup (CREATE DATABASE ...
 * TEMPLATE). Workers rewrite PRISMA_DATABASE_URL before anything connects.
 */
import os from 'node:os';
import type { INestApplication } from '@nestjs/common';

export interface ISharedBundle {
  app: INestApplication<unknown>;
  appUrl: string;
  cookie: string;
  sessionID: string;
}

interface ISharedEntry {
  bundle: ISharedBundle;
  proxied: ISharedBundle;
  refreshSession?: () => Promise<Pick<ISharedBundle, 'cookie' | 'sessionID'>>;
}

interface ISharedState {
  // Boot promises, stored synchronously: concurrent initApp calls (the eagerly
  // booting setup file races the first spec file — vitest does not await setup
  // promises) join the same in-flight boot instead of double-booting.
  registry: Map<string, Promise<ISharedEntry>>;
  resolved: Map<string, ISharedEntry>;
  baselineEnv?: Record<string, string | undefined>;
  originalDbUrl?: string;
  originalCacheRedisUri?: string;
  originalPerfCacheUri?: string;
  /** First shared app to finish booting — the worker's canonical axios target. */
  primaryKey?: string;
  /** Interceptor-list lengths right after the primary shared app registered its own. */
  axiosSnapshot?: { request: number; response: number };
  /** Private apps awaiting cleanup in classic app-per-file mode. */
  strayFreshApps: Set<() => Promise<void>>;
  /** Async cleanup from the runner's per-file reset; awaited by the next initApp. */
  pendingMaintenance?: Promise<unknown>;
}

/**
 * Env keys that never force a private app and are not reset between files.
 * PORT/STORAGE_PREFIX are NOT ignored: the shared boot merges its values into the
 * baseline, and restoring them after a private-app file matters — the server
 * builds attachment URLs from STORAGE_PREFIX at request time, so a dead private
 * app's leftover value would break later files.
 */
const IGNORED_ENV_KEYS = new Set(['VITEST_POOL_ID', 'VITEST_WORKER_ID', 'NODE_OPTIONS']);

function state(): ISharedState {
  const g = globalThis as any;
  g.__teableE2eShared ??= {
    registry: new Map(),
    resolved: new Map(),
    strayFreshApps: new Set(),
  } satisfies ISharedState;
  return g.__teableE2eShared;
}

/**
 * Strict opt-in: the e2e vitest configs set E2E_SHARED_APP=1. Other configs that
 * reuse initApp (vitest-ai, bench) keep the classic app-per-file behavior.
 */
export function sharedAppEnabled(): boolean {
  return process.env.E2E_SHARED_APP === '1';
}

// Redis db per worker must stay within redis' 16 default databases, clear of the
// dev defaults (0/1) and the dedicated BullMQ e2e db (14).
const MAX_E2E_WORKERS = 12;

export function resolveE2eMaxWorkers(): number {
  if (process.env.E2E_FILE_PARALLELISM === '0') return 1;
  const explicit = Number(process.env.E2E_MAX_WORKERS || 0);
  if (explicit > 0) return Math.min(explicit, MAX_E2E_WORKERS);
  const cpus = os.availableParallelism?.() ?? os.cpus().length;
  // Hosted CI runners are small (2 vCPU / 7GB); each worker holds a full Nest app.
  if (process.env.CI) return 3;
  return Math.max(2, Math.min(8, Math.floor(cpus / 2)));
}

/**
 * Capture the post-setup env as the reference for fingerprinting and per-file
 * restore. Setup files re-run for every test file, so only the first capture
 * (right after the shared app booted) counts.
 */
export function captureBaselineEnv(): void {
  state().baselineEnv ??= { ...process.env };
}

export function restoreBaselineEnv(): void {
  const baseline = state().baselineEnv;
  if (!baseline) return;
  const restored: string[] = [];
  for (const key of Object.keys(process.env)) {
    if (IGNORED_ENV_KEYS.has(key)) continue;
    if (!(key in baseline)) {
      delete process.env[key];
      restored.push(key);
    }
  }
  for (const [key, value] of Object.entries(baseline)) {
    if (IGNORED_ENV_KEYS.has(key)) continue;
    if (process.env[key] !== value) {
      process.env[key] = value;
      restored.push(key);
    }
  }
  if (restored.length > 0 && process.env.E2E_PROBE) {
    // eslint-disable-next-line no-console
    console.log(`[e2e-shared] restored env after file: ${restored.join(', ')}`);
  }
}

function envDiffFromBaseline(): string[] {
  const baseline = state().baselineEnv;
  if (!baseline) return []; // eager boot happens before the baseline is captured
  const keys = new Set([...Object.keys(baseline), ...Object.keys(process.env)]);
  const diff: string[] = [];
  for (const key of keys) {
    if (IGNORED_ENV_KEYS.has(key)) continue;
    if ((baseline[key] ?? undefined) !== (process.env[key] ?? undefined)) {
      diff.push(key);
    }
  }
  return diff;
}

export interface IBootResult {
  bundle: ISharedBundle;
  cookieInterceptorId: number;
  refreshSession?: () => Promise<Pick<ISharedBundle, 'cookie' | 'sessionID'>>;
}

/**
 * Resolve an app for the calling spec file: reuse this worker's shared app, boot
 * it if it doesn't exist yet, or fall back to a private app when the caller's env
 * diverges from the worker baseline (spec customized process.env before initApp).
 */
let privateBootCounter = 0;

/**
 * Boot a private app under its own BullMQ queue prefix so the worker's shared
 * app (same redis db) can't consume the private app's jobs, or vice versa.
 */
export async function bootWithPrivateQueues<T>(boot: () => Promise<T>): Promise<T> {
  const previous = process.env.BACKEND_QUEUE_PREFIX;
  process.env.BACKEND_QUEUE_PREFIX = `bullp${process.env.VITEST_POOL_ID ?? 0}x${++privateBootCounter}`;
  try {
    return await boot();
  } finally {
    if (previous === undefined) {
      delete process.env.BACKEND_QUEUE_PREFIX;
    } else {
      process.env.BACKEND_QUEUE_PREFIX = previous;
    }
  }
}

export function setPendingMaintenance(promise: Promise<unknown>): void {
  state().pendingMaintenance = promise.catch(() => undefined);
}

export async function acquireApp(
  cacheKey: string,
  boot: () => Promise<IBootResult>,
  restoreAxios: (bootResult: IBootResult) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  axios?: any
): Promise<ISharedBundle> {
  // Let the previous file's async cleanup (cache value flush) settle before this
  // file starts priming caches.
  const pending = state().pendingMaintenance;
  if (pending) {
    state().pendingMaintenance = undefined;
    await pending;
  }
  const envDiff = sharedAppEnabled() ? envDiffFromBaseline() : [];
  if (!sharedAppEnabled() || envDiff.length > 0) {
    if (envDiff.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[e2e-shared] private app for "${cacheKey}", env differs: ${envDiff.join(', ')}`);
    }
    const bootResult = await bootWithPrivateQueues(boot);
    return wrapFreshApp(bootResult.bundle, () => restoreAxios(bootResult));
  }

  const st = state();
  let entryPromise = st.registry.get(cacheKey);
  const reusing = Boolean(entryPromise);
  if (!entryPromise) {
    // Files run sequentially inside a worker, so nothing else executes test code
    // while this boot is in flight: any env delta across the boot is a boot
    // artifact (e.g. SSL_CERT_FILE) — absorb it into the baseline so later files
    // aren't misclassified as env-customized.
    const preBootEnv = { ...process.env };
    entryPromise = boot().then(({ bundle, refreshSession }) => {
      const baseline = st.baselineEnv;
      if (baseline) {
        const keys = new Set([...Object.keys(preBootEnv), ...Object.keys(process.env)]);
        for (const key of keys) {
          if ((preBootEnv[key] ?? undefined) !== (process.env[key] ?? undefined)) {
            baseline[key] = process.env[key];
          }
        }
      }
      const entry: ISharedEntry = {
        bundle,
        proxied: { ...bundle, app: closelessApp(bundle.app) },
        refreshSession,
      };
      st.resolved.set(cacheKey, entry);
      if (!st.primaryKey && axios) {
        st.primaryKey = cacheKey;
        st.axiosSnapshot = {
          request: axios.interceptors.request.handlers.length,
          response: axios.interceptors.response.handlers.length,
        };
      }
      return entry;
    });
    st.registry.set(cacheKey, entryPromise);
  }
  const entry = await entryPromise;
  if (reusing && entry.refreshSession) {
    const session = await entry.refreshSession();
    Object.assign(entry.bundle, session);
    Object.assign(entry.proxied, session);
  }
  // Self-heal on reuse: probe auth and reboot the shared app when it can no
  // longer authenticate (see sharedAppAuthBroken for the mechanism).
  if (reusing && axios && (await sharedAppAuthBroken(cacheKey, entry, axios))) {
    st.registry.delete(cacheKey);
    st.resolved.delete(cacheKey);
    if (st.primaryKey === cacheKey) {
      st.primaryKey = undefined;
      st.axiosSnapshot = undefined;
    }
    await entry.bundle.app.close().catch(() => undefined);
    return acquireApp(cacheKey, boot, restoreAxios, axios);
  }
  // Reusing a secondary shared app (e.g. the EE-edition app while CLOUD is the
  // worker primary): point the axios singleton at it — booting did this, reuse
  // must too. The runner resets back to the primary after the file.
  if (axios) {
    axios.defaults.baseURL = entry.bundle.appUrl + '/api';
  }
  return { ...entry.proxied };
}

/**
 * Whether the shared app persistently rejects its own canonical session over
 * HTTP. Process-global singletons leak across app instances — passport
 * strategies, for example, self-register on the process-global passport at
 * construction (last boot wins) and capture their own app's services; after a
 * private app closes, HTTP auth on the surviving shared app can 401 every
 * request even though the session store itself is intact (verified in CI:
 * a middleware replay resolves the session while a protected HTTP request
 * 401s). The caller reboots the shared app instead of letting every remaining
 * file in the worker fail.
 */
async function sharedAppAuthBroken(
  cacheKey: string,
  entry: ISharedEntry,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  axios: any
): Promise<boolean> {
  const probeStatus = await axios
    .get(`${entry.bundle.appUrl}/api/space`, {
      headers: { Cookie: entry.bundle.cookie },
      validateStatus: () => true,
    })
    .then((res: { status: number }) => res.status)
    .catch(() => undefined);
  if (probeStatus !== 401) return false;
  process.stderr.write(
    `[e2e-shared] auth probe on the shared app "${cacheKey}" returned 401; rebooting it\n`
  );
  return true;
}

/* --------------------------- axios singleton hygiene --------------------------- */

/**
 * The openapi package's axios singleton is worker-global. Under the old
 * app-per-file model every file started from a fresh process; here the runner
 * resets the singleton to the shared app's state after each file so a spec that
 * booted a private app (or added interceptors) can't poison the next file.
 * The axios instance is passed in by the caller (worker-side modules only).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resetAxiosToSharedApp(axios: any): void {
  const st = state();
  if (!st.primaryKey || !st.axiosSnapshot) return;
  const entry = st.resolved.get(st.primaryKey);
  if (!entry) return;
  axios.defaults.baseURL = entry.bundle.appUrl + '/api';
  for (let id = st.axiosSnapshot.request; id < axios.interceptors.request.handlers.length; id++) {
    axios.interceptors.request.eject(id);
  }
  for (let id = st.axiosSnapshot.response; id < axios.interceptors.response.handlers.length; id++) {
    axios.interceptors.response.eject(id);
  }
}

function closelessApp(app: INestApplication<unknown>): INestApplication<unknown> {
  return new Proxy(app, {
    get(target, prop) {
      if (prop === 'close') {
        return async () => undefined;
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function' ? (value as any).bind(target) : value;
    },
  });
}

export function getSharedBundle(cacheKey: string): ISharedBundle | undefined {
  return state().resolved.get(cacheKey)?.bundle;
}

export function getAllSharedBundles(): ISharedBundle[] {
  return [...state().resolved.values()].map((entry) => entry.bundle);
}

/**
 * Wrap a privately-booted app so its close() restores the axios singleton. While
 * the shared harness is enabled it must not close the Nest app: independently
 * compiled testing modules still share process-global Prisma/Knex resources, and
 * shutting one down can end the canonical app's pools. Worker exit owns teardown.
 */
export function wrapFreshApp(bundle: ISharedBundle, restoreAxios: () => void): ISharedBundle {
  const app = bundle.app;
  const realClose = app.close.bind(app);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    state().strayFreshApps.delete(close);
    restoreAxios();
    if (!sharedAppEnabled()) {
      await realClose();
    }
  };
  if (!sharedAppEnabled()) {
    state().strayFreshApps.add(close);
  }
  const proxied = new Proxy(app, {
    get(target, prop) {
      if (prop === 'close') return close;
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function' ? (value as any).bind(target) : value;
    },
  });
  return { ...bundle, app: proxied };
}

/**
 * Close unclaimed private apps only in classic app-per-file mode. Shared-app
 * workers intentionally keep them alive until process teardown (see above).
 */
export function reapStrayFreshApps(): void {
  for (const close of [...state().strayFreshApps]) {
    void close().catch(() => undefined);
  }
}

/* ------------------------------- worker databases ------------------------------- */

export function workerDbEnabled(): boolean {
  return process.env.E2E_WORKER_DB !== '0';
}

export function workerDatabaseUrl(url: string, poolId: number): string {
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '');
  parsed.pathname = `/${dbName}_w${poolId}`;
  // Keep the original connection_limit: concurrency-heavy specs need the full
  // pool. The CI postgres runs with max_connections=500 to absorb N workers.
  return parsed.toString();
}

/**
 * Point PRISMA_DATABASE_URL at this worker's database clone. Must run in the worker
 * setup file before anything opens a connection. Setup files re-run for every test
 * file, so always derive from the original template URL (idempotent).
 */
export function applyWorkerDatabaseEnv(): void {
  if (!workerDbEnabled()) return;
  const poolId = Number(process.env.VITEST_POOL_ID || 0);
  if (!poolId || resolveE2eMaxWorkers() <= 1) return;

  const url = (state().originalDbUrl ??= process.env.PRISMA_DATABASE_URL);
  if (url) {
    process.env.PRISMA_DATABASE_URL = workerDatabaseUrl(url, poolId);
  }

  // The redis cache holds sessions and permission caches keyed by the shared seed
  // user; concurrent workers on one redis db would clobber each other (e.g. the
  // auth specs invalidating every worker's session). One redis db per worker.
  const cacheUri = (state().originalCacheRedisUri ??= process.env.BACKEND_CACHE_REDIS_URI);
  if (cacheUri && process.env.BACKEND_CACHE_PROVIDER === 'redis') {
    const parsed = new URL(cacheUri);
    parsed.pathname = `/${poolId}`;
    process.env.BACKEND_CACHE_REDIS_URI = parsed.toString();
  }

  // Same isolation for the performance cache: its keys are global strings (e.g.
  // the instance setting containing the canary config), so a shared redis db
  // would let workers read each other's settings.
  const perfUri = (state().originalPerfCacheUri ??= process.env.BACKEND_PERFORMANCE_CACHE);
  if (perfUri) {
    const parsed = new URL(perfUri);
    parsed.pathname = `/${poolId}`;
    process.env.BACKEND_PERFORMANCE_CACHE = parsed.toString();
  }
}

/**
 * globalSetup helper: clone the seeded template database once per worker.
 * Runs in the vitest main process before any worker spawns.
 */
export async function provisionWorkerDatabases(): Promise<void> {
  if (!workerDbEnabled()) return;
  const url = process.env.PRISMA_DATABASE_URL;
  const workers = resolveE2eMaxWorkers();
  if (!url || workers <= 1) return;

  const parsed = new URL(url);
  const template = parsed.pathname.replace(/^\//, '');
  const admin = new URL(url);
  admin.pathname = '/postgres';
  admin.search = '';

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where datname like $1 and pid <> pg_backend_pid()`,
      [`${template}%`]
    );
    for (let poolId = 1; poolId <= workers; poolId++) {
      const dbName = `${template}_w${poolId}`;
      await client.query(`drop database if exists "${dbName}"`);
      await client.query(`create database "${dbName}" template "${template}"`);
    }
    // eslint-disable-next-line no-console
    console.log(`[e2e] provisioned ${workers} worker databases from template "${template}"`);
  } finally {
    await client.end();
  }

  await flushWorkerRedisDbs(workers);
}

/**
 * Redis outlives a run on dev boxes; cached values (sessions, the 1-day-TTL
 * instance settings in the performance cache) from a previous run would poison
 * freshly cloned worker databases. Flush each worker's redis db up front.
 */
async function flushWorkerRedisDbs(workers: number): Promise<void> {
  const uri = process.env.BACKEND_CACHE_REDIS_URI ?? process.env.BACKEND_PERFORMANCE_CACHE;
  if (!uri) return;
  try {
    const { default: redisCtor } = await import('ioredis');
    const redis = new redisCtor(uri, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    for (let poolId = 1; poolId <= workers; poolId++) {
      await redis.select(poolId);
      await redis.flushdb();
    }
    redis.disconnect();
    // eslint-disable-next-line no-console
    console.log(`[e2e] flushed redis dbs 1..${workers}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[e2e] redis flush skipped: ${(error as Error).message}`);
  }
}
