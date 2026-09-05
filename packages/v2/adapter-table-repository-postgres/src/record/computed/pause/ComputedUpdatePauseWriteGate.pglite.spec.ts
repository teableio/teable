import { COMPUTE_PAUSED_WRITE_BLOCKED_CODE, type ILogger } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import { ComputedUpdatePauseRegistry } from './ComputedUpdatePauseRegistry';

const SPACE_ID = `spc${'s'.repeat(16)}`;
const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;

const createLogger = (): ILogger => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => createLogger(),
  scope: () => createLogger(),
});

describe('ComputedUpdatePauseRegistry write gate', () => {
  let harness: PGliteTestDb;
  let db: Kysely<V1TeableDatabase>;
  let registry: ComputedUpdatePauseRegistry;

  beforeAll(async () => {
    harness = await createPGliteDb();
    db = harness.db;

    await db.schema
      .createTable('space')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('name', 'text')
      .execute();
    await db.schema
      .createTable('base')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('space_id', 'text', (col) => col.notNull())
      .addColumn('name', 'text')
      .execute();
    await db.schema
      .createTable('table_meta')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('base_id', 'text', (col) => col.notNull())
      .addColumn('name', 'text')
      .addColumn('deleted_time', 'timestamptz')
      .execute();
    await db.schema
      .createTable('computed_update_pause_scope')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('scope_type', 'text', (col) => col.notNull())
      .addColumn('scope_id', 'text', (col) => col.notNull())
      .addColumn('paused_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('paused_by', 'text')
      .addColumn('resume_at', 'timestamptz')
      .addColumn('reason', 'text')
      .addColumn('write_policy', 'text', (col) => col.notNull().defaultTo('allow_bounded'))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_by', 'text')
      .execute();
    await sql`
      CREATE UNIQUE INDEX "computed_update_pause_scope_scope_type_scope_id_key"
      ON "computed_update_pause_scope"("scope_type", "scope_id")
    `.execute(db);
    await db.schema
      .createTable('computed_update_outbox')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('base_id', 'text', (col) => col.notNull())
      .addColumn('seed_table_id', 'text', (col) => col.notNull())
      .addColumn('status', 'text', (col) => col.notNull())
      .addColumn('affected_table_ids', sql`text[]`, (col) =>
        col.notNull().defaultTo(sql`ARRAY[]::text[]`)
      )
      .addColumn('next_run_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    await db.insertInto('space').values({ id: SPACE_ID, name: 'Space' }).execute();
    await db.insertInto('base').values({ id: BASE_ID, space_id: SPACE_ID, name: 'Base' }).execute();
    await db
      .insertInto('table_meta')
      .values({ id: TABLE_ID, base_id: BASE_ID, name: 'Table', deleted_time: null })
      .execute();

    registry = new ComputedUpdatePauseRegistry(db, createLogger());
  });

  afterAll(async () => {
    await harness.pglite.close();
  });

  beforeEach(async () => {
    await db.deleteFrom('computed_update_outbox').execute();
    await db.deleteFrom('computed_update_pause_scope').execute();
  });

  it('admits writes when no pause is effective', async () => {
    const result = await registry.admitComputedWrite({ tableId: TABLE_ID, baseId: BASE_ID });
    expect(result.isOk()).toBe(true);
  });

  it('blocks computed-producing writes with COMPUTE_PAUSED_WRITE_BLOCKED', async () => {
    const paused = await registry.pauseScope({
      scopeType: 'base',
      scopeId: BASE_ID,
      resumeAt: new Date(Date.now() + 30 * 60 * 1000),
      actor: 'ops',
      writePolicy: 'block',
    });
    expect(paused.isOk()).toBe(true);

    const result = await registry.admitComputedWrite({ tableId: TABLE_ID, baseId: BASE_ID });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(COMPUTE_PAUSED_WRITE_BLOCKED_CODE);
    expect(error.details).toMatchObject({
      scopeType: 'base',
      scopeId: BASE_ID,
      writePolicy: 'block',
      leaseId: paused._unsafeUnwrap().id,
    });
    expect(typeof error.details?.retryAt).toBe('string');
  });

  it('keeps allow_bounded writes available below the backlog watermark', async () => {
    const paused = await registry.pauseScope({
      scopeType: 'base',
      scopeId: BASE_ID,
      resumeAt: new Date(Date.now() + 30 * 60 * 1000),
      actor: 'ops',
      writePolicy: 'allow_bounded',
    });
    expect(paused.isOk()).toBe(true);

    const result = await registry.admitComputedWrite({
      tableId: TABLE_ID,
      baseId: BASE_ID,
      backlogWatermark: 2,
    });
    expect(result.isOk()).toBe(true);
    expect(paused._unsafeUnwrap().active).toBe(true);
  });

  it('auto-releases allow_bounded pauses at the backlog watermark', async () => {
    const paused = await registry.pauseScope({
      scopeType: 'base',
      scopeId: BASE_ID,
      resumeAt: new Date(Date.now() + 30 * 60 * 1000),
      actor: 'ops',
      writePolicy: 'allow_bounded',
    });
    expect(paused.isOk()).toBe(true);

    await db
      .insertInto('computed_update_outbox')
      .values({
        id: 'cuo-pending-1',
        base_id: BASE_ID,
        seed_table_id: TABLE_ID,
        status: 'pending',
        affected_table_ids: [TABLE_ID],
        next_run_at: new Date(),
        updated_at: new Date(),
      })
      .execute();
    await db
      .insertInto('computed_update_outbox')
      .values({
        id: 'cuo-pending-2',
        base_id: BASE_ID,
        seed_table_id: TABLE_ID,
        status: 'pending',
        affected_table_ids: [TABLE_ID],
        next_run_at: new Date(),
        updated_at: new Date(),
      })
      .execute();

    const result = await registry.admitComputedWrite({
      tableId: TABLE_ID,
      baseId: BASE_ID,
      backlogWatermark: 2,
    });
    expect(result.isOk()).toBe(true);

    const listed = await registry.listScopes({ activeOnly: true });
    expect(listed.isOk()).toBe(true);
    expect(listed._unsafeUnwrap()).toHaveLength(0);
  });

  it('does not join the caller transaction when admitting writes', async () => {
    const result = await registry.admitComputedWrite({ tableId: TABLE_ID, baseId: BASE_ID }, {
      transaction: {
        kind: 'unitOfWorkTransaction',
        get db(): never {
          throw new Error('admit must not use the caller transaction');
        },
      },
    } as never);
    expect(result.isOk()).toBe(true);
  });
});
