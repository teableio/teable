import { serve } from '@hono/node-server';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import { createHeadlessHttpApp } from '@teable/v2-headless-http';
import {
  createHeadlessRuntime,
  type IHeadlessRuntime,
  type IHeadlessRuntimeBackend,
} from '@teable/v2-headless-runtime';
import { LocalAttachmentStore } from '@teable/v2-local-attachments';
import type { Kysely } from 'kysely';

export interface IHeadlessServerOptions {
  backend: IHeadlessRuntimeBackend;
  port?: number;
  hostname?: string;
  attachmentsDir?: string;
  actorHeader?: string;
  defaultActorId?: string;
  allowAnonymousActor?: boolean;
}

export interface IHeadlessServer {
  runtime: IHeadlessRuntime;
  close(): Promise<void>;
}

/**
 * Resolves the runtime backend from environment variables. PGlite is selected
 * by `TEABLE_PGLITE_DIR`; PostgreSQL otherwise. PostgreSQL bootstrap is opt-in.
 */
export const resolveBackendFromEnv = (env: NodeJS.ProcessEnv): IHeadlessRuntimeBackend => {
  if (env.TEABLE_PGLITE_DIR) {
    return {
      kind: 'pglite',
      dataDir: env.TEABLE_PGLITE_DIR,
      bootstrap: env.TEABLE_BOOTSTRAP !== 'false',
    };
  }
  if (env.TEABLE_DATABASE_URL || env.TEABLE_META_DATABASE_URL) {
    return {
      kind: 'postgres',
      connectionString: env.TEABLE_DATABASE_URL,
      metaConnectionString: env.TEABLE_META_DATABASE_URL,
      dataConnectionString: env.TEABLE_DATA_DATABASE_URL,
      bootstrap: env.TEABLE_BOOTSTRAP === 'true',
    };
  }
  throw new Error('Set TEABLE_PGLITE_DIR or TEABLE_DATABASE_URL/TEABLE_META_DATABASE_URL');
};

export const startHeadlessServer = async (
  options: IHeadlessServerOptions
): Promise<IHeadlessServer> => {
  const runtime = await createHeadlessRuntime({
    backend: options.backend,
    attachments: options.attachmentsDir
      ? ({ container }) =>
          new LocalAttachmentStore({
            db: container.resolve<Kysely<unknown>>(v2MetaDbTokens.db),
            rootDir: options.attachmentsDir as string,
            actorId: 'usr_headless',
          })
      : undefined,
  });
  const app = createHeadlessHttpApp(runtime, {
    actorHeader: options.actorHeader,
    defaultActorId: options.defaultActorId,
    allowAnonymousActor: options.allowAnonymousActor,
  });
  const server = serve({
    fetch: app.fetch,
    port: options.port ?? 3000,
    hostname: options.hostname ?? '127.0.0.1',
  });

  return {
    runtime,
    close: async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      server.close(() => resolve());
      await promise;
      await runtime.close();
    },
  };
};
