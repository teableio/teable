import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import {
  installUndoCaptureGlobals,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  createV2BrowserContainer,
  type IV2BrowserPgliteContainerOptions,
} from '@teable/v2-container-browser';
import {
  createV2NodePgContainer,
  disposeV2NodePgContainer,
  type IV2NodePgContainerOptions,
} from '@teable/v2-container-node';
import {
  v2CoreTokens,
  type AttachmentItem,
  type ICommandBus,
  type IQueryBus,
  type IRealtimeEngine,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { sql, type Kysely } from 'kysely';

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
  /** Drain pending formula/lookup/rollup tasks. Returns the number processed. */
  flushComputed(): Promise<number>;
  /** Wait for deferred realtime projection delivery. */
  flushRealtime(): Promise<void>;
  close(): Promise<void>;
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

const closePglite = async (container: DependencyContainer): Promise<void> => {
  const db = container.resolve<{ destroy(): Promise<void> }>(v2DataDbTokens.db);
  await db.destroy();
};

class HeadlessRuntime<TRealtime extends IRealtimeEngine> implements IHeadlessRuntime<TRealtime> {
  readonly commandBus: ICommandBus;
  readonly queryBus: IQueryBus;
  private readonly computedWorker: ComputedUpdateWorker;
  #closed = false;

  constructor(
    readonly backend: HeadlessRuntimeBackendKind,
    readonly container: DependencyContainer,
    private readonly dispose: () => Promise<void>,
    readonly realtime: TRealtime,
    readonly attachments?: IHeadlessRuntimeAttachmentStore
  ) {
    this.commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    this.queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    this.computedWorker = container.resolve<ComputedUpdateWorker>(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    );
  }

  async flushComputed(): Promise<number> {
    let processed = 0;
    for (let batch = 0; batch < 100; batch += 1) {
      const result = await this.computedWorker.runOnce({
        workerId: 'headless-runtime',
        limit: 100,
      });
      if (result.isErr()) {
        throw new Error(`Computed update failed: ${String(result.error)}`);
      }
      processed += result.value;
      if (result.value === 0) {
        return processed;
      }
    }
    throw new Error('Computed update did not drain after 100 batches');
  }

  async flushRealtime(): Promise<void> {
    for (let tick = 0; tick < 3; tick += 1) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.dispose();
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
export async function createHeadlessRuntime(
  options: IHeadlessRuntimeOptions
): Promise<IHeadlessRuntime<IRealtimeEngine>> {
  if (options.backend.kind === 'pglite') {
    const { options: browserOptions, bootstrap, actor } = toPgliteOptions(options.backend);
    const container = await createV2BrowserContainer(browserOptions);
    const realtime = options.realtime ?? new LocalRealtimeEngine();
    registerRealtime(container, realtime);
    if (bootstrap) {
      await bootstrapLocalDatabase(container.resolve<Kysely<unknown>>(v2DataDbTokens.db), actor);
    }
    const attachments = options.attachments
      ? await options.attachments({ container, backend: 'pglite' })
      : undefined;
    return new HeadlessRuntime(
      'pglite',
      container,
      () => closePglite(container),
      realtime,
      attachments
    );
  }

  const { options: nodeOptions, bootstrap, actor } = toPostgresOptions(options.backend);
  const container = await createV2NodePgContainer(nodeOptions);
  const realtime = options.realtime ?? new LocalRealtimeEngine();
  registerRealtime(container, realtime);
  if (bootstrap) {
    await bootstrapLocalDatabase(container.resolve<Kysely<unknown>>(v2DataDbTokens.db), actor);
  }
  const attachments = options.attachments
    ? await options.attachments({ container, backend: 'postgres' })
    : undefined;
  return new HeadlessRuntime(
    'postgres',
    container,
    () => disposeV2NodePgContainer(container),
    realtime,
    attachments
  );
}
