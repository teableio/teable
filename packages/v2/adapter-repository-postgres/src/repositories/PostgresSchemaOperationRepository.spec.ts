import { ActorId, type IExecutionContext } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureV1MetaSchema } from '../db/schema';
import { PostgresSchemaOperationRepository } from './PostgresSchemaOperationRepository';

type StartedPostgreSqlContainer = Awaited<ReturnType<PostgreSqlContainer['start']>>;

const createPgDb = async (connectionString: string): Promise<Kysely<V1TeableDatabase>> => {
  const pg = (await import('pg')) as typeof import('pg') & { default?: typeof import('pg') };
  const Pool = pg.Pool ?? pg.default?.Pool;
  if (!Pool) {
    throw new Error('Missing pg.Pool');
  }

  return new Kysely<V1TeableDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString }),
    }),
  });
};

const context = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

describe('PostgresSchemaOperationRepository (pg)', () => {
  let pgContainer: StartedPostgreSqlContainer | undefined;
  let db: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('teable_v2_schema_operation_test')
      .withUsername('teable')
      .withPassword('teable')
      .start();
    db = await createPgDb(pgContainer.getConnectionUri());
    await ensureV1MetaSchema(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await pgContainer?.stop();
  });

  it('claims due operations by supported type and releases the lock when advanced', async () => {
    const repository = new PostgresSchemaOperationRepository(db);
    const now = new Date('2026-04-28T00:00:00.000Z');
    await repository.upsert(context(), {
      type: 'table.create',
      status: 'pending',
      phase: 'metadata_pending',
      target: {
        resourceType: 'table',
        resourceId: 'tblClaim000000001',
        tableId: 'tblClaim000000001',
      },
      idempotencyKey: 'claim-create:table:tblClaim000000001',
      payload: { tableId: 'tblClaim000000001' },
      nextRunAt: now,
    });
    await repository.upsert(context(), {
      type: 'table.update',
      status: 'pending',
      phase: 'metadata_pending',
      target: {
        resourceType: 'table',
        resourceId: 'tblClaim000000002',
        tableId: 'tblClaim000000002',
      },
      idempotencyKey: 'claim-update:table:tblClaim000000002',
      payload: { tableId: 'tblClaim000000002' },
      nextRunAt: now,
    });

    const claimed = await repository.claimNextRunnable(context(), {
      lockedBy: 'worker-1',
      now,
      types: ['table.create'],
    });

    const operation = claimed._unsafeUnwrap();
    expect(operation).toMatchObject({
      idempotencyKey: 'claim-create:table:tblClaim000000001',
      lockedBy: 'worker-1',
      phase: 'running',
      status: 'running',
    });

    const secondClaim = await repository.claimNextRunnable(context(), {
      lockedBy: 'worker-2',
      now,
      types: ['table.create'],
    });
    expect(secondClaim._unsafeUnwrap()).toBeUndefined();

    const completed = await repository.advance(context(), operation!.idempotencyKey, {
      status: 'ready',
      phase: 'ready',
      result: { repaired: true },
      nextRunAt: now,
    });

    expect(completed._unsafeUnwrap()).toMatchObject({
      lockedAt: null,
      lockedBy: null,
      result: { repaired: true },
      status: 'ready',
    });
  });

  it('lists operations and supports manual retry and mark-dead controls', async () => {
    const repository = new PostgresSchemaOperationRepository(db);
    const now = new Date('2026-04-28T02:00:00.000Z');
    const retryKey = 'manual-retry:table:tblManualRetry0001';
    const deadKey = 'manual-dead:table:tblManualDead00001';

    await repository.upsert(context(), {
      type: 'table.create',
      status: 'dead',
      phase: 'error',
      target: {
        resourceType: 'table',
        resourceId: 'tblManualRetry0001',
        baseId: 'bseManualControls',
        tableId: 'tblManualRetry0001',
      },
      idempotencyKey: retryKey,
      payload: { tableId: 'tblManualRetry0001', recordCount: 0 },
      lastError: 'unsupported before manual retry',
      nextRunAt: now,
    });
    await repository.upsert(context(), {
      type: 'table.import',
      status: 'error',
      phase: 'error',
      target: {
        resourceType: 'table',
        resourceId: 'tblManualDead00001',
        baseId: 'bseManualControls',
        tableId: 'tblManualDead00001',
      },
      idempotencyKey: deadKey,
      payload: { tableId: 'tblManualDead00001', recordCount: 0 },
      lastError: 'needs manual decision',
      nextRunAt: now,
    });

    const listed = await repository.list(context(), {
      statuses: ['dead', 'error'],
      baseIds: ['bseManualControls'],
      limit: 10,
    });

    expect(listed._unsafeUnwrap()).toMatchObject({
      total: 2,
      items: expect.arrayContaining([
        expect.objectContaining({ idempotencyKey: retryKey, status: 'dead' }),
        expect.objectContaining({ idempotencyKey: deadKey, status: 'error' }),
      ]),
    });

    const retried = await repository.manualRetry(context(), {
      selector: { idempotencyKey: retryKey },
      now,
    });

    expect(retried._unsafeUnwrap()).toMatchObject({
      attempts: 0,
      idempotencyKey: retryKey,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      nextRunAt: now,
      phase: 'error',
      status: 'error',
    });

    const markedDead = await repository.markDead(context(), {
      selector: { idempotencyKey: deadKey },
      now,
      reason: 'manual terminal decision',
    });

    expect(markedDead._unsafeUnwrap()).toMatchObject({
      idempotencyKey: deadKey,
      lastError: 'manual terminal decision',
      lockedAt: null,
      lockedBy: null,
      phase: 'error',
      status: 'dead',
    });
  });
});
