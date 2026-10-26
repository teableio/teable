import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import {
  ActorId,
  CreateBaseCommand,
  ListBasesQuery,
  type CreateBaseResult,
  type ListBasesResult,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { createHeadlessRuntime } from './index';

// Opt-in like the other pg integration suites: ordinary unit runs must not
// reach for Docker.
const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;

const POSTGRES_IMAGE = 'postgres:16-alpine';
const DATABASE = 'teable_headless';
const READY_TIMEOUT_MS = 90_000;

const execFileAsync = promisify(execFile);

const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.isErr()) {
    throw new Error(String(result.error));
  }
  return result.value;
};

const createContext = () => ({ actorId: unwrap(ActorId.create('usr_headless')) });

const freePort = async (): Promise<number> => {
  const server = createServer();
  const listening = Promise.withResolvers<void>();
  server.once('error', listening.reject);
  server.listen(0, '127.0.0.1', listening.resolve);
  await listening.promise;
  const address = server.address();
  if (!address || typeof address === 'string') {
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    await closed.promise;
    throw new Error('Could not allocate a loopback port for PostgreSQL');
  }
  const { port } = address;
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
  return port;
};

const startPostgres = async (name: string, port: number): Promise<{ connectionString: string }> => {
  await execFileAsync('docker', [
    'run',
    '--detach',
    '--name',
    name,
    '--publish',
    `127.0.0.1:${port}:5432`,
    '--env',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '--env',
    `POSTGRES_DB=${DATABASE}`,
    POSTGRES_IMAGE,
  ]);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await execFileAsync('docker', ['exec', name, 'pg_isready', '-U', 'postgres', '-d', DATABASE]);
      return { connectionString: `postgres://postgres@127.0.0.1:${port}/${DATABASE}` };
    } catch {
      await delay(250);
    }
  }
  throw new Error(`PostgreSQL container ${name} did not become ready within ${READY_TIMEOUT_MS}ms`);
};

const removeContainer = async (name: string): Promise<void> => {
  try {
    await execFileAsync('docker', ['rm', '--force', name]);
  } catch {
    // The container may never have been created; nothing left to clean up.
  }
};

describePg('createHeadlessRuntime on a virgin PostgreSQL database', () => {
  it('provisions the schema for bootstrap:true and persists across restarts', async () => {
    const port = await freePort();
    const name = `teable-headless-pg-${process.pid}-${Date.now()}`;
    const { connectionString } = await startPostgres(name, port);

    try {
      // Exactly the documented shape: no ensureSchema.
      const backend = { kind: 'postgres' as const, connectionString, bootstrap: true };
      const first = await createHeadlessRuntime({ backend });
      let baseId: string;
      try {
        const context = createContext();
        const created = unwrap(
          await first.commandBus.execute<CreateBaseCommand, CreateBaseResult>(
            context,
            unwrap(CreateBaseCommand.create({ name: 'Virgin database base' }))
          )
        );
        baseId = created.base.id().toString();
      } finally {
        await first.close();
      }

      const second = await createHeadlessRuntime({ backend });
      try {
        const listed = unwrap(
          await second.queryBus.execute<ListBasesQuery, ListBasesResult>(
            createContext(),
            unwrap(ListBasesQuery.create({}))
          )
        );
        expect(
          listed.bases.map((base) => ({ id: base.id().toString(), name: base.name().toString() }))
        ).toContainEqual({ id: baseId, name: 'Virgin database base' });
      } finally {
        await second.close();
      }
    } finally {
      await removeContainer(name);
    }
  }, 240_000);
});
