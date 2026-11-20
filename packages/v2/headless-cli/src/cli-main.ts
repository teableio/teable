import 'reflect-metadata';

import { timingSafeEqual } from 'node:crypto';

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
  TEABLE_HEADLESS_TOKEN       Require this local Bearer token for API requests
  TEABLE_DATA_QUERY_CURSOR_SIGNING_KEY  Private key for continuing cursors across restarts
  TEABLE_DEFAULT_ACTOR        Explicit fallback actor (default: none; missing actor is 401)
  TEABLE_ALLOW_ANONYMOUS      true/false; allow the legacy anonymous system actor (default false)
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
  const token = process.env.TEABLE_HEADLESS_TOKEN;
  if (token !== undefined && !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) {
    throw new Error('TEABLE_HEADLESS_TOKEN must be a nonempty Bearer token');
  }
  const expectedToken = token === undefined ? undefined : Buffer.from(token);
  const defaultActorId = process.env.TEABLE_DEFAULT_ACTOR;
  const tokenActorId = defaultActorId ?? backend.actor?.id ?? 'usr_headless';
  const dataQueryCursorSigningKey = process.env.TEABLE_DATA_QUERY_CURSOR_SIGNING_KEY || undefined;

  const server = await startHeadlessServer({
    backend,
    dataQueryCursorSigningKey,
    port,
    hostname,
    attachmentsDir: process.env.TEABLE_ATTACHMENTS_DIR,
    actorHeader: process.env.TEABLE_ACTOR_HEADER,
    defaultActorId,
    allowAnonymousActor: process.env.TEABLE_ALLOW_ANONYMOUS === 'true',
    resolveIdentity: expectedToken
      ? (request) => {
          const bearer = /^Bearer +([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
          if (bearer) {
            const provided = Buffer.from(bearer);
            if (provided.length === expectedToken.length && timingSafeEqual(provided, expectedToken)) {
              return { status: 'accepted', actorId: tokenActorId };
            }
          }
          return { status: 'rejected', statusCode: 401 };
        }
      : undefined,
  });

  console.log(`teable-headless listening on http://${hostname}:${port}`);
  const shutdown = async (): Promise<void> => {
    try {
      await server.close();
      process.exit(0);
    } catch (error) {
      console.error(
        error instanceof Error ? `teable-headless close failed: ${error.message}` : String(error)
      );
      process.exit(1);
    }
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
};
