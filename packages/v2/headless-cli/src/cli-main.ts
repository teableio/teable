import 'reflect-metadata';

import type { IHeadlessRuntimeBackend } from '@teable/v2-headless-runtime';

import { resolveBackendFromEnv, startHeadlessServer } from './index';

const HELP = `teable-headless

Environment:
  TEABLE_PGLITE_DIR           Use a local PGlite directory
  TEABLE_DATABASE_URL         PostgreSQL URL for both meta and data
  TEABLE_META_DATABASE_URL    PostgreSQL URL for meta
  TEABLE_DATA_DATABASE_URL    PostgreSQL URL for data
  TEABLE_BOOTSTRAP            true/false; PostgreSQL bootstrap is off by default
  TEABLE_ATTACHMENTS_DIR      Local attachment directory
  TEABLE_ACTOR_HEADER         Actor header (default x-teable-actor)
  TEABLE_DEFAULT_ACTOR        Fallback actor (default system)
  PORT                        HTTP port (default 3000)
  HOST                        Bind host (default 127.0.0.1)
`;

export interface IHeadlessCliOptions {
  /**
   * Overrides environment-based backend resolution, e.g. to inject embedded
   * PGlite assets in a single-file binary.
   */
  resolveBackend?: (
    env: NodeJS.ProcessEnv
  ) => IHeadlessRuntimeBackend | Promise<IHeadlessRuntimeBackend>;
}

export const runHeadlessCli = async (options: IHeadlessCliOptions = {}): Promise<void> => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  const backend = await (options.resolveBackend ?? resolveBackendFromEnv)(process.env);
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${process.env.PORT ?? ''}`);
  }
  const hostname = process.env.HOST ?? '127.0.0.1';

  const server = await startHeadlessServer({
    backend,
    port,
    hostname,
    attachmentsDir: process.env.TEABLE_ATTACHMENTS_DIR,
    actorHeader: process.env.TEABLE_ACTOR_HEADER,
    defaultActorId: process.env.TEABLE_DEFAULT_ACTOR,
  });

  console.log(`teable-headless listening on http://${hostname}:${port}`);
  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
};
