import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import {
  installUndoCaptureGlobals,
  NodeImportEventSpoolFactory,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
  type DomainEventOutboxWorker,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  createV2BrowserContainer,
  type IV2BrowserPgliteContainerOptions,
} from '@teable/v2-container-browser';
import type { IV2NodePgContainerOptions } from '@teable/v2-container-node';
import {
  domainError,
  v2CoreTokens,
  type AttachmentItem,
  type DomainError,
  type ICommandBus,
  type IExecutionContext,
  type IImportEventSpoolFactory,
  type IPublicCommand,
  type IQueryBus,
  type IRealtimeEngine,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { registerV2ImportServices } from '@teable/v2-import';
import type { ISsrfSafeFetchFn } from '@teable/v2-utils';

import { sql, type Kysely } from 'kysely';
import { err } from 'neverthrow';
import {
  ComputedQueueSummaryUnavailableError,
  readComputedQueueSummary,
  type IComputedQueueSummaryOptions,
} from './computedQueueSummary';
import {
  readDomainEventQueueSummary,
  type IDomainEventQueueSummary,
} from './domainEventQueueSummary';
import type { IPgliteDataDirLock } from './pgliteDataDirLock';
import { LocalRealtimeEngine } from './realtime';
import { registerRealtime } from './registerRealtime';

export type HeadlessRuntimeBackendKind = 'pglite' | 'postgres';

export interface IHeadlessRuntimeActor {
  id: string;
  name: string;
  email?: string;
}

export type IHeadlessRuntimePgliteBackend = Omit<
  IV2BrowserPgliteContainerOptions,
  'connectionString'
> & {
  kind: 'pglite';
  dataDir: string;
  /** Install the local users/undo bootstrap. Defaults to true. */
  bootstrap?: boolean;
  actor?: IHeadlessRuntimeActor;
};

export type IHeadlessRuntimePostgresBackend = IV2NodePgContainerOptions & {
  kind: 'postgres';
  /**
   * Install the local users/undo bootstrap into the data database.
   * Defaults to false because an external database may be shared.
   */
  bootstrap?: boolean;
  actor?: IHeadlessRuntimeActor;
};

export type IHeadlessRuntimeBackend =
  | IHeadlessRuntimePgliteBackend
  | IHeadlessRuntimePostgresBackend;

export interface IHeadlessRuntimeOptions {
  backend: IHeadlessRuntimeBackend;
  attachments?: HeadlessRuntimeAttachmentsFactory;
  /** Realtime engine owned by the host. Defaults to an in-process LocalRealtimeEngine. */
  realtime?: IRealtimeEngine;
  /** Browser-safe host fetch for URL imports. Node defaults to strict SSRF protection. */
  importFetch?: ISsrfSafeFetchFn;
  /** Browser hosts may provide bounded import-event snapshot storage. */
  importEventSpoolFactory?: IImportEventSpoolFactory;
}

export interface IHeadlessRuntimeAttachmentStore {
  put(input: {
    name: string;
    mimetype: string;
    data: Uint8Array;
    width?: number;
    height?: number;
  }): Promise<AttachmentItem>;
  read(token: string): Promise<Uint8Array>;
}

export type HeadlessRuntimeAttachmentsFactory = (context: {
  container: DependencyContainer;
  backend: HeadlessRuntimeBackendKind;
}) => IHeadlessRuntimeAttachmentStore | Promise<IHeadlessRuntimeAttachmentStore>;

export interface IHeadlessRuntime<TRealtime extends IRealtimeEngine = LocalRealtimeEngine> {
  readonly backend: HeadlessRuntimeBackendKind;
  readonly container: DependencyContainer;
  readonly commandBus: ICommandBus;
  readonly queryBus: IQueryBus;
  readonly attachments?: IHeadlessRuntimeAttachmentStore;
  readonly realtime: TRealtime;
  /** Bounded attempt followed by a read-only queue summary. */
  flushComputed(): Promise<IComputedFlushReport>;
  flushRealtime(): Promise<{ state: 'settled' | 'unsupported'; failedTasks?: number }>;
  flushBackground(): Promise<IBackgroundFlushReport>;
  /** Executes a database probe; throws when closed or unavailable. */
  ready(): Promise<void>;
  close(): Promise<void>;
}

export interface IComputedFlushReport {
  processed: number;
  state:
    | 'no_claimable_work'
    | 'work_limit_reached'
    | 'pending_work'
    | 'dead_letter_pending'
    | 'summary_unavailable';
  pending: number | null;
  scheduled: number | null;
  processing: number | null;
  paused: number | null;
  deadLetter: number | null;
  nextRunAt: string | null;
  drained: boolean;
}

export interface IBackgroundDurableSummary {
  durablePending: number | null;
  scheduled: number | null;
  processing: number | null;
  deadLetter: number | null;
  nextRunAt: string | null;
}

export interface IBackgroundFlushReport extends IBackgroundDurableSummary {
  processed: number;
  state:
    | 'no_claimable_work'
    | 'work_limit_reached'
    | 'worker_unavailable'
    | 'dead_letter_pending'
    | 'summary_unavailable';
  available: boolean;
  failedTasks: number;
}

class RuntimeCloseTimeoutError extends Error {
  constructor() {
    super('Headless runtime close deadline exceeded');
  }
}

const raceDeadline = <T>(work: Promise<T>, deadline: number): Promise<T> => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new RuntimeCloseTimeoutError());
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => reject(new RuntimeCloseTimeoutError()), remaining);
  timer.unref?.();
  work.then(resolve, reject).finally(() => clearTimeout(timer));
  return promise;
};

const hasErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

export class HeadlessRuntimeCloseError extends Error {
  readonly code = 'runtime.close_incomplete';

  constructor(
    readonly details: {
      failedTasks: number;
      timedOut: boolean;
      lockLost?: boolean;
      counts?: {
        pending: number | null;
        scheduled: number | null;
        processing: number | null;
        durablePending: number | null;
        deadLetter: number | null;
        nextRunAt: string | null;
      };
      cause?: unknown;
    }
  ) {
    super(
      details.lockLost
        ? 'PGlite data directory lock was lost while closing'
        : details.timedOut
          ? 'Headless runtime close timed out while settling background work'
          : 'Headless runtime closed with failed background work'
    );
  }
}

export class HeadlessRuntimeClosedError extends Error {
  readonly code = 'runtime.closed';

  constructor() {
    super('Headless runtime is closed');
  }
}

export class PgliteDataDirLockLostError extends Error {
  readonly code = 'pglite.data_dir_lock_lost';

  constructor() {
    super('PGlite data directory lock was lost');
  }
}

const DEFAULT_ACTOR: IHeadlessRuntimeActor = {
  id: 'usr_headless',
  name: 'Headless',
};

type ResolvedPgliteOptions = {
  options: IV2BrowserPgliteContainerOptions;
  bootstrap: boolean;
  actor: IHeadlessRuntimeActor;
};

type ResolvedPostgresOptions = {
  options: IV2NodePgContainerOptions;
  bootstrap: boolean;
  actor: IHeadlessRuntimeActor;
};

const toPgliteOptions = (backend: IHeadlessRuntimePgliteBackend): ResolvedPgliteOptions => {
  const { kind, dataDir, bootstrap = true, actor = DEFAULT_ACTOR, ...options } = backend;
  if (kind !== 'pglite') {
    throw new Error('Expected a pglite headless runtime backend');
  }
  return { options: { ...options, connectionString: dataDir }, bootstrap, actor };
};

/**
 * A first run against a virgin database needs the meta schema before any
 * command can insert a row. `bootstrap: true` means "this runtime may own the
 * database", so it provisions the schema unless the host decided explicitly.
 * `bootstrap: false` keeps the shared-database contract: nothing is created
 * unless `ensureSchema` asks for it.
 */
export const resolvePostgresEnsureSchema = (
  backend: Pick<IHeadlessRuntimePostgresBackend, 'bootstrap' | 'ensureSchema'>
): boolean | undefined => {
  if (backend.ensureSchema !== undefined) {
    return backend.ensureSchema;
  }
  return backend.bootstrap === true ? true : undefined;
};

const toPostgresOptions = (backend: IHeadlessRuntimePostgresBackend): ResolvedPostgresOptions => {
  const { kind, bootstrap = false, actor = DEFAULT_ACTOR, ensureSchema, ...options } = backend;
  if (kind !== 'postgres') {
    throw new Error('Expected a postgres headless runtime backend');
  }
  const resolvedEnsureSchema = resolvePostgresEnsureSchema({ bootstrap, ensureSchema });
  return {
    options: {
      ...options,
      ...(resolvedEnsureSchema === undefined ? {} : { ensureSchema: resolvedEnsureSchema }),
    },
    bootstrap,
    actor,
  };
};

const bootstrapLocalDatabase = async (
  db: Kysely<unknown>,
  actor: IHeadlessRuntimeActor
): Promise<void> => {
  await sql`
    create table if not exists public.users (
      id varchar(255) primary key,
      name varchar(255) not null,
      email varchar(255)
    )
  `.execute(db);
  await sql`
    insert into public.users (id, name, email)
    values (${actor.id}, ${actor.name}, ${actor.email ?? null})
    on conflict (id) do nothing
  `.execute(db);
  await installUndoCaptureGlobals(db);
};
const resolveImportFetch = async (
  injected: ISsrfSafeFetchFn | undefined
): Promise<ISsrfSafeFetchFn> => {
  if (injected) return injected;
  if (typeof process === 'undefined' || typeof process.getBuiltinModule !== 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  // Platform-specific Node module: a static import would pull undici into browser bundles.
  const { createSsrfSafeFetch } = await import('@teable/v2-utils');
  return createSsrfSafeFetch({ allowPrivateNetwork: false });
};

const createRuntimeWorkQueue = async (
  unsafeError?: () => Error | undefined,
  serialize = true
): Promise<RuntimeWorkQueue> => {
  // Node-only concurrency primitive: browsers do not expose a safe async-context API.
  const asyncHooks = await import('node:async_hooks');
  const queue = new RuntimeWorkQueue(unsafeError, serialize);
  queue.setContext(new asyncHooks.AsyncLocalStorage<IRuntimeScope>());
  return queue;
};

const loadPgliteDataDirLock = async (
  dataDir: string,
  onCompromised: (error: Error) => void
): Promise<IPgliteDataDirLock | undefined> => {
  if (
    dataDir.startsWith('memory://') ||
    dataDir.startsWith('idb://') ||
    dataDir.startsWith('opfs-ahp://')
  ) {
    return undefined;
  }
  if (typeof process === 'undefined' || typeof process.getBuiltinModule !== 'function') {
    throw new Error('Persistent PGlite ownership requires a Node or Bun host');
  }
  // Node-only filesystem lock: ESM keeps this lazy; CJS output is Node-only.
  const { acquirePgliteDataDirLock } = await import('./pgliteDataDirLock');
  return acquirePgliteDataDirLock(dataDir, { onCompromised });
};

const closePglite = async (
  container: DependencyContainer,
  lock?: IPgliteDataDirLock
): Promise<void> => {
  try {
    const db = container.resolve<{ destroy(): Promise<void> }>(v2DataDbTokens.db);
    await db.destroy();
  } finally {
    await lock?.release();
  }
};
type HeadlessRuntimeInit<TRealtime extends IRealtimeEngine> = {
  realtime: TRealtime;
  attachments?: IHeadlessRuntimeAttachmentStore;
};

const initializeContainer = async <TRealtime extends IRealtimeEngine>(
  container: DependencyContainer,
  options: IHeadlessRuntimeOptions,
  backend: HeadlessRuntimeBackendKind,
  bootstrap: boolean,
  actor: IHeadlessRuntimeActor
): Promise<HeadlessRuntimeInit<TRealtime>> => {
  const importFetch = await resolveImportFetch(options.importFetch);
  registerV2ImportServices(container, { fetch: importFetch });
  const realtime = (options.realtime ?? new LocalRealtimeEngine()) as TRealtime;
  registerRealtime(container, realtime);
  if (bootstrap) {
    await bootstrapLocalDatabase(container.resolve<Kysely<unknown>>(v2DataDbTokens.db), actor);
  }
  const attachments = options.attachments
    ? await options.attachments({ container, backend })
    : undefined;
  return { realtime, attachments };
};

interface IAsyncContext<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
}

interface IRuntimeScope {
  active: boolean;
}

class RuntimeWorkQueue {
  #tail = Promise.resolve();
  #unsafeError: () => Error | undefined;
  #context?: IAsyncContext<IRuntimeScope>;

  constructor(
    unsafeError: () => Error | undefined = () => undefined,
    private readonly serialize = true
  ) {
    this.#unsafeError = unsafeError;
  }

  setContext(context: IAsyncContext<IRuntimeScope>): void {
    this.#context = context;
  }

  run<T>(work: () => Promise<T>, allowUnsafe = false): Promise<T> {
    const unsafe = this.#unsafeError();
    if (unsafe && !allowUnsafe) return Promise.reject(unsafe);
    const current = this.#context?.getStore();
    if (current?.active) return work();
    if (!this.serialize) {
      const scope: IRuntimeScope = { active: true };
      const run = () => (this.#context ? this.#context.run(scope, work) : work());
      return Promise.resolve()
        .then(run)
        .finally(() => {
          scope.active = false;
        });
    }
    return this.enqueue(work, allowUnsafe);
  }

  isActive(): boolean {
    return this.#context?.getStore()?.active === true;
  }

  enqueue<T>(work: () => Promise<T>, allowUnsafe = false): Promise<T> {
    const queued = this.#tail.then(async () => {
      if (!allowUnsafe) {
        const unsafe = this.#unsafeError();
        if (unsafe) throw unsafe;
      }
      const scope: IRuntimeScope = { active: true };
      try {
        return await (this.#context ? this.#context.run(scope, work) : work());
      } finally {
        scope.active = false;
      }
    });
    this.#tail = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }

  async idle(): Promise<void> {
    for (;;) {
      const tail = this.#tail;
      await tail;
      if (tail === this.#tail) return;
    }
  }
}

class RuntimeInflight {
  private count = 0;
  private readonly waiters: Array<() => void> = [];

  begin(): void {
    this.count += 1;
  }

  end(): void {
    this.count -= 1;
    if (this.count === 0) {
      for (const resolve of this.waiters.splice(0)) resolve();
    }
  }

  async idle(): Promise<void> {
    while (this.count > 0) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.waiters.push(resolve);
      await promise;
    }
  }
}

class RuntimeBackgroundTasks {
  private readonly pending = new Set<Promise<void>>();
  private failedTasks = 0;

  constructor(private readonly queue: RuntimeWorkQueue) {}

  schedule(task: () => Promise<void> | void): void {
    const running = this.queue
      .enqueue(async () => task())
      .catch(() => {
        this.failedTasks += 1;
      });
    this.pending.add(running);
    void running.finally(() => this.pending.delete(running));
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  async settled(): Promise<{ failedTasks: number }> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
    return { failedTasks: this.failedTasks };
  }
}

const withBackgroundTracker = (
  context: IExecutionContext,
  tracker: RuntimeBackgroundTasks
): IExecutionContext => ({
  ...context,
  scheduleBackgroundTask: (task) => tracker.schedule(task),
});

class QueuedCommandBus implements ICommandBus {
  constructor(
    private readonly raw: ICommandBus,
    private readonly queue: RuntimeWorkQueue | undefined,
    private readonly isClosed: () => boolean,
    private readonly tracker: RuntimeBackgroundTasks,
    private readonly inflight: RuntimeInflight
  ) {}

  execute<TCommand extends IPublicCommand, TResult>(context: IExecutionContext, command: TCommand) {
    if (this.isClosed() && !(this.queue?.isActive() ?? false)) {
      return Promise.resolve(
        err<TResult, DomainError>(
          domainError.infrastructure({
            code: 'runtime.closed',
            message: 'Headless runtime is closed',
          })
        )
      );
    }
    this.inflight.begin();
    const execute = () =>
      this.raw.execute<TCommand, TResult>(withBackgroundTracker(context, this.tracker), command);
    const running = this.queue ? this.queue.run(execute) : execute();
    return running.finally(() => this.inflight.end());
  }
}

class QueuedQueryBus implements IQueryBus {
  constructor(
    private readonly raw: IQueryBus,
    private readonly queue: RuntimeWorkQueue | undefined,
    private readonly isClosed: () => boolean,
    private readonly tracker: RuntimeBackgroundTasks,
    private readonly inflight: RuntimeInflight
  ) {}

  execute<TQuery, TResult>(context: IExecutionContext, query: TQuery) {
    if (this.isClosed() && !(this.queue?.isActive() ?? false)) {
      return Promise.resolve(
        err<TResult, DomainError>(
          domainError.infrastructure({
            code: 'runtime.closed',
            message: 'Headless runtime is closed',
          })
        )
      );
    }
    this.inflight.begin();
    const execute = () =>
      this.raw.execute<TQuery, TResult>(withBackgroundTracker(context, this.tracker), query);
    const running = this.queue ? this.queue.run(execute) : execute();
    return running.finally(() => this.inflight.end());
  }
}

class HeadlessRuntime<TRealtime extends IRealtimeEngine> implements IHeadlessRuntime<TRealtime> {
  readonly commandBus: ICommandBus;
  readonly queryBus: IQueryBus;
  private readonly computedWorker: ComputedUpdateWorker;
  private readonly db: Kysely<unknown>;
  private readonly queue?: RuntimeWorkQueue;
  private readonly backgroundTasks: RuntimeBackgroundTasks;
  private readonly inflight = new RuntimeInflight();
  private readonly eventBus?: { settled(): Promise<void> };
  #closing = false;
  #closed = false;
  #closePromise?: Promise<void>;

  constructor(
    readonly backend: HeadlessRuntimeBackendKind,
    readonly container: DependencyContainer,
    private readonly dispose: () => Promise<void>,
    readonly realtime: TRealtime,
    readonly attachments?: IHeadlessRuntimeAttachmentStore,
    queue?: RuntimeWorkQueue,
    backgroundTasks?: RuntimeBackgroundTasks,
    private readonly summaryOptions: IComputedQueueSummaryOptions & {
      schema?: string;
      spacePauseResolvable?: boolean;
    } = {}
  ) {
    const rawCommandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const rawQueryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    this.queue = queue;
    this.backgroundTasks =
      backgroundTasks ?? new RuntimeBackgroundTasks(queue ?? new RuntimeWorkQueue());
    const eventBusCandidate = container.resolve<unknown>(v2CoreTokens.eventBus);
    let settleEventBus: (() => Promise<void>) | undefined;
    if (
      eventBusCandidate &&
      typeof eventBusCandidate === 'object' &&
      'settled' in eventBusCandidate &&
      typeof eventBusCandidate.settled === 'function'
    ) {
      const candidateSettled = eventBusCandidate.settled;
      settleEventBus = async () => {
        await candidateSettled.call(eventBusCandidate);
      };
    }
    this.eventBus = settleEventBus ? { settled: settleEventBus } : undefined;
    this.commandBus = new QueuedCommandBus(
      rawCommandBus,
      queue,
      () => this.#closing || this.#closed,
      this.backgroundTasks,
      this.inflight
    );
    this.queryBus = new QueuedQueryBus(
      rawQueryBus,
      queue,
      () => this.#closing || this.#closed,
      this.backgroundTasks,
      this.inflight
    );
    container.registerInstance(v2CoreTokens.commandBus, this.commandBus);
    container.registerInstance(v2CoreTokens.queryBus, this.queryBus);
    this.db = container.resolve<Kysely<unknown>>(v2DataDbTokens.db);
    this.computedWorker = container.resolve<ComputedUpdateWorker>(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    );
  }

  private async settleProjections(): Promise<{ failedTasks: number }> {
    for (let round = 0; round < 100; round += 1) {
      await this.inflight.idle();
      await this.queue?.idle();
      const background = await this.backgroundTasks.settled();
      await this.eventBus?.settled();
      if (this.backgroundTasks.pendingCount === 0) {
        await this.queue?.idle();
        if (this.backgroundTasks.pendingCount === 0) return background;
      }
    }
    throw new Error('Realtime projection delivery did not settle');
  }

  private async readDurableSummary(): Promise<IDomainEventQueueSummary> {
    return readDomainEventQueueSummary(this.db, new Date(), this.summaryOptions.schema);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- bounded drain + typed summary fallback
  async flushComputed(internal = false): Promise<IComputedFlushReport> {
    // eslint-disable-next-line sonarjs/cognitive-complexity -- bounded drain + typed summary fallback
    const work = async () => {
      if (!internal && (this.#closing || this.#closed)) throw new HeadlessRuntimeClosedError();
      try {
        await readComputedQueueSummary(this.db, new Date(), this.summaryOptions);
      } catch (error) {
        if (error instanceof ComputedQueueSummaryUnavailableError) {
          return {
            processed: 0,
            state: 'summary_unavailable' as const,
            pending: null,
            scheduled: null,
            processing: null,
            paused: null,
            deadLetter: null,
            nextRunAt: null,
            drained: false,
          };
        }
        throw error;
      }
      let processed = 0;
      let limitReached = true;
      for (let batch = 0; batch < 100; batch += 1) {
        const result = await this.computedWorker.runOnce({
          workerId: 'headless-runtime',
          limit: 100,
        });
        if (result.isErr()) throw new Error(`Computed update failed: ${String(result.error)}`);
        processed += result.value;
        if (result.value === 0) {
          limitReached = false;
          break;
        }
      }
      let summary;
      try {
        summary = await readComputedQueueSummary(this.db, new Date(), this.summaryOptions);
      } catch (error) {
        if (error instanceof ComputedQueueSummaryUnavailableError) {
          return {
            processed,
            state: 'summary_unavailable' as const,
            pending: null,
            scheduled: null,
            processing: null,
            paused: null,
            deadLetter: null,
            nextRunAt: null,
            drained: false,
          };
        }
        throw error;
      }
      const state = limitReached
        ? ('work_limit_reached' as const)
        : summary.pending > 0
          ? ('pending_work' as const)
          : summary.deadLetter > 0
            ? ('dead_letter_pending' as const)
            : ('no_claimable_work' as const);
      return {
        processed,
        state,
        pending: summary.pending,
        scheduled: summary.scheduled,
        processing: summary.processing,
        paused: summary.paused,
        deadLetter: summary.deadLetter,
        nextRunAt: summary.nextRunAt?.toISOString() ?? null,
        drained: summary.pending === 0 && summary.deadLetter === 0,
      };
    };
    return this.queue ? this.queue.run(work) : work();
  }

  async flushRealtime(): Promise<{ state: 'settled' | 'unsupported'; failedTasks?: number }> {
    if (this.#closing || this.#closed) throw new HeadlessRuntimeClosedError();
    if (!(this.realtime instanceof LocalRealtimeEngine)) return { state: 'unsupported' };
    const background = await this.settleProjections();
    return { state: 'settled', failedTasks: background.failedTasks };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- worker, direct work and queue summary
  async flushBackground(internal = false): Promise<IBackgroundFlushReport> {
    if (!internal && (this.#closing || this.#closed)) throw new HeadlessRuntimeClosedError();
    const worker = this.container.isRegistered(
      v2RecordRepositoryPostgresTokens.domainEventOutboxWorker
    )
      ? this.container.resolve<DomainEventOutboxWorker>(
          v2RecordRepositoryPostgresTokens.domainEventOutboxWorker
        )
      : undefined;
    const workerAvailable = worker !== undefined;
    const processed = worker ? await this.pollDurableWorker(worker) : 0;
    const settled = await this.settleProjections();
    let summary;
    try {
      summary = await this.readDurableSummary();
    } catch {
      return {
        processed,
        state: 'summary_unavailable',
        available: workerAvailable,
        failedTasks: settled.failedTasks,
        durablePending: null,
        scheduled: null,
        processing: null,
        deadLetter: null,
        nextRunAt: null,
      };
    }
    const liveWork = (summary.durablePending ?? 0) > 0 || (summary.processing ?? 0) > 0;
    const deadOnly = !liveWork && (summary.deadLetter ?? 0) > 0;
    return {
      processed,
      state:
        liveWork && !workerAvailable
          ? 'worker_unavailable'
          : liveWork
            ? 'work_limit_reached'
            : deadOnly
              ? 'dead_letter_pending'
              : 'no_claimable_work',
      available: workerAvailable,
      failedTasks: settled.failedTasks,
      ...summary,
    };
  }

  private async pollDurableWorker(worker: DomainEventOutboxWorker): Promise<number> {
    let processed = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await worker.pollOnce();
      if (result.isErr()) throw new Error(`Background delivery failed: ${String(result.error)}`);
      processed += result.value;
      if (result.value === 0) break;
    }
    return processed;
  }

  async ready(): Promise<void> {
    if (this.#closing || this.#closed) throw new HeadlessRuntimeClosedError();
    const probe = async () => void (await sql`select 1`.execute(this.db));
    await (this.queue ? this.queue.run(probe) : probe());
  }

  close(): Promise<void> {
    this.#closePromise ??= this.closeOnce();
    return this.#closePromise;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- deadline check per settlement stage
  private async settleForClose(deadline: number): Promise<{
    failedTasks: number;
    timedOut: boolean;
  }> {
    let failedTasks = 0;
    for (;;) {
      try {
        await raceDeadline(this.inflight.idle(), deadline);
        await raceDeadline(this.queue?.idle() ?? Promise.resolve(), deadline);
        failedTasks = (await raceDeadline(this.backgroundTasks.settled(), deadline)).failedTasks;
        await raceDeadline(this.eventBus?.settled() ?? Promise.resolve(), deadline);
        if (this.backgroundTasks.pendingCount === 0) {
          await raceDeadline(this.queue?.idle() ?? Promise.resolve(), deadline);
          if (this.backgroundTasks.pendingCount === 0) return { failedTasks, timedOut: false };
        }
      } catch (error) {
        if (error instanceof RuntimeCloseTimeoutError) return { failedTasks, timedOut: true };
        throw error;
      }
      if (Date.now() >= deadline) return { failedTasks, timedOut: true };
    }
  }

  private resetCloseAttempt(): void {
    this.#closing = false;
    this.#closePromise = undefined;
  }

  private async closeOnce(): Promise<void> {
    this.#closing = true;
    let failedTasks = 0;
    let timedOut = false;
    try {
      ({ failedTasks, timedOut } = await this.settleForClose(Date.now() + 5_000));
    } catch (error) {
      this.resetCloseAttempt();
      throw error;
    }
    if (timedOut) {
      this.resetCloseAttempt();
      throw new HeadlessRuntimeCloseError({ failedTasks, timedOut: true });
    }

    let computed: IComputedFlushReport;
    let background: IBackgroundFlushReport;
    try {
      computed = await this.flushComputed(true);
      background = await this.flushBackground(true);
    } catch (cause) {
      this.resetCloseAttempt();
      throw new HeadlessRuntimeCloseError({ failedTasks, timedOut: false, cause });
    }
    const summaryUnavailable =
      computed.state === 'summary_unavailable' || background.state === 'summary_unavailable';
    const hasWork =
      (computed.pending ?? 0) > 0 ||
      (computed.scheduled ?? 0) > 0 ||
      (computed.processing ?? 0) > 0 ||
      (computed.deadLetter ?? 0) > 0 ||
      (background.durablePending ?? 0) > 0 ||
      (background.scheduled ?? 0) > 0 ||
      (background.processing ?? 0) > 0 ||
      (background.deadLetter ?? 0) > 0;
    const sumCounts = (left: number | null, right: number | null): number | null =>
      left === null || right === null ? null : left + right;
    const counts = {
      pending: computed.pending,
      scheduled: sumCounts(computed.scheduled, background.scheduled),
      processing: sumCounts(computed.processing, background.processing),
      durablePending: background.durablePending,
      deadLetter: sumCounts(computed.deadLetter, background.deadLetter),
      nextRunAt:
        [computed.nextRunAt, background.nextRunAt]
          .filter((value): value is string => value !== null)
          .sort()[0] ?? null,
    };
    const totalFailed = Math.max(failedTasks, background.failedTasks);
    let disposeError: unknown;
    try {
      await this.dispose();
    } catch (error) {
      disposeError = error;
    } finally {
      this.#closed = true;
    }
    const lockLost = hasErrorCode(disposeError, 'pglite.data_dir_lock_lost');
    if (disposeError || hasWork || summaryUnavailable || totalFailed > 0 || lockLost) {
      throw new HeadlessRuntimeCloseError({
        failedTasks: totalFailed,
        timedOut: false,
        lockLost,
        counts,
        cause: disposeError,
      });
    }
  }
}

/**
 * Creates a headless Teable runtime without UI, auth, billing, or a cloud
 * control plane. The host owns identity and presentation; the runtime owns the
 * Table bounded context and its persistence.
 */
export function createHeadlessRuntime(
  options: IHeadlessRuntimeOptions & { realtime?: undefined }
): Promise<IHeadlessRuntime<LocalRealtimeEngine>>;
export function createHeadlessRuntime<TRealtime extends IRealtimeEngine>(
  options: IHeadlessRuntimeOptions & { realtime: TRealtime }
): Promise<IHeadlessRuntime<TRealtime>>;
export function createHeadlessRuntime(
  options: IHeadlessRuntimeOptions
): Promise<IHeadlessRuntime<IRealtimeEngine>>;
// eslint-disable-next-line sonarjs/cognitive-complexity -- two composition roots with cleanup paths
export async function createHeadlessRuntime(
  options: IHeadlessRuntimeOptions
): Promise<IHeadlessRuntime<IRealtimeEngine>> {
  if (options.backend.kind === 'pglite') {
    const { options: browserOptions, bootstrap, actor } = toPgliteOptions(options.backend);
    let lockLost = false;
    const dataDirLock = await loadPgliteDataDirLock(options.backend.dataDir, () => {
      lockLost = true;
    });
    let container: DependencyContainer | undefined;
    try {
      const importEventSpoolFactory =
        options.importEventSpoolFactory ??
        (typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function'
          ? new NodeImportEventSpoolFactory()
          : undefined);
      container = await createV2BrowserContainer({ ...browserOptions, importEventSpoolFactory });
      const init = await initializeContainer(container, options, 'pglite', bootstrap, actor);
      const queue =
        typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function'
          ? await createRuntimeWorkQueue(() =>
              lockLost ? new PgliteDataDirLockLostError() : undefined
            )
          : undefined;
      return new HeadlessRuntime(
        'pglite',
        container,
        () => closePglite(container!, dataDirLock),
        init.realtime,
        init.attachments,
        queue
      );
    } catch (error) {
      let cleanupError: unknown;
      try {
        if (container) await closePglite(container, dataDirLock);
        else await dataDirLock?.release();
      } catch (caught) {
        cleanupError = caught;
      }
      if (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'PGlite headless runtime construction and cleanup both failed'
        );
      }
      throw error;
    }
  }

  const { options: nodeOptions, bootstrap, actor } = toPostgresOptions(options.backend);
  const metaConnection = nodeOptions.metaConnectionString ?? nodeOptions.connectionString;
  const dataConnection = nodeOptions.dataConnectionString ?? nodeOptions.connectionString;
  const summaryOptions = {
    ...(nodeOptions.dataSchema ? { schema: nodeOptions.dataSchema } : {}),
    spacePauseResolvable: metaConnection === dataConnection && !nodeOptions.dataSchema,
  };
  const nodeContainer = await import('@teable/v2-container-node');
  const queue = await createRuntimeWorkQueue(undefined, false);
  let container: DependencyContainer | undefined;
  try {
    container = await nodeContainer.createV2NodePgContainer(nodeOptions);
    const init = await initializeContainer(container, options, 'postgres', bootstrap, actor);
    return new HeadlessRuntime(
      'postgres',
      container,
      () => nodeContainer.disposeV2NodePgContainer(container!),
      init.realtime,
      init.attachments,
      queue,
      new RuntimeBackgroundTasks(queue),
      summaryOptions
    );
  } catch (error) {
    if (container) {
      try {
        await nodeContainer.disposeV2NodePgContainer(container);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'PostgreSQL headless runtime construction and cleanup both failed'
        );
      }
    }
    throw error;
  }
}
