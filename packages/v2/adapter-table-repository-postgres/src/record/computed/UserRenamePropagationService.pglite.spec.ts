import { ActorId, UserId } from '@teable/v2-core';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPGliteDb } from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { UserRenamePropagationService } from './UserRenamePropagationService';

type PGliteDb = Awaited<ReturnType<typeof createPGliteDb>>;

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;
const DATA_TABLE_NAME = `${BASE_ID}.${TABLE_ID}` as const;

const createLogger = () => ({
  child: () => createLogger(),
  scope: () => createLogger(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('UserRenamePropagationService BYODB split database behavior', () => {
  let data: PGliteDb;
  let meta: PGliteDb;

  beforeAll(async () => {
    data = await createPGliteDb();
    meta = await createPGliteDb();

    await data.db.schema.createSchema(BASE_ID).execute();
    await data.db.schema
      .createTable(DATA_TABLE_NAME)
      .addColumn('__id', 'varchar', (col) => col.primaryKey())
      .addColumn('usr_col', 'jsonb')
      .execute();

    await meta.db.schema
      .createTable('collaborator')
      .addColumn('principal_type', 'varchar')
      .addColumn('principal_id', 'varchar')
      .addColumn('resource_id', 'varchar')
      .execute();
    await meta.db.schema
      .createTable('space')
      .addColumn('id', 'varchar', (col) => col.primaryKey())
      .addColumn('deleted_time', 'timestamp')
      .execute();
    await meta.db.schema
      .createTable('base')
      .addColumn('id', 'varchar', (col) => col.primaryKey())
      .addColumn('space_id', 'varchar')
      .addColumn('deleted_time', 'timestamp')
      .execute();
    await meta.db.schema
      .createTable('table_meta')
      .addColumn('id', 'varchar', (col) => col.primaryKey())
      .addColumn('base_id', 'varchar')
      .addColumn('db_table_name', 'varchar')
      .addColumn('deleted_time', 'timestamp')
      .execute();
    await meta.db.schema
      .createTable('field')
      .addColumn('id', 'varchar', (col) => col.primaryKey())
      .addColumn('table_id', 'varchar')
      .addColumn('type', 'varchar')
      .addColumn('is_lookup', 'boolean')
      .addColumn('is_multiple_cell_value', 'boolean')
      .addColumn('db_field_name', 'varchar')
      .addColumn('deleted_time', 'timestamp')
      .execute();
  });

  afterAll(async () => {
    await data.db.destroy();
    await meta.db.destroy();
  });

  it('reads affected user-field metadata from meta DB and patches snapshots in data DB', async () => {
    const actorId = ActorId.create('usrActor000000001')._unsafeUnwrap();
    const userId = UserId.create('usrTarget00000001')._unsafeUnwrap();
    const refreshService = {
      refreshAfterExternalValueChanges: vi.fn().mockResolvedValue({ isErr: () => false, isOk: () => true }),
    };
    const service = new UserRenamePropagationService(
      data.db,
      createLogger() as never,
      refreshService as never,
      meta.db
    );

    await meta.db.insertInto('space').values({ id: `spc${'s'.repeat(16)}` }).execute();
    await meta.db
      .insertInto('base')
      .values({ id: BASE_ID, space_id: `spc${'s'.repeat(16)}` })
      .execute();
    await meta.db
      .insertInto('collaborator')
      .values({
        principal_type: 'user',
        principal_id: userId.toString(),
        resource_id: BASE_ID,
      })
      .execute();
    await meta.db
      .insertInto('table_meta')
      .values({
        id: TABLE_ID,
        base_id: BASE_ID,
        db_table_name: DATA_TABLE_NAME,
      })
      .execute();
    await meta.db
      .insertInto('field')
      .values({
        id: FIELD_ID,
        table_id: TABLE_ID,
        type: 'user',
        db_field_name: 'usr_col',
        is_multiple_cell_value: false,
      })
      .execute();
    await data.db
      .insertInto(DATA_TABLE_NAME)
      .values({
        __id: 'rec_user_rename',
        usr_col: sql`jsonb_build_object('id', ${userId.toString()}::text, 'title', 'Old Name')`,
      })
      .execute();

    const result = await service.propagateUserRename(
      { actorId },
      { userId, name: 'New Name' }
    );

    expect(result.isOk()).toBe(true);
    const row = await data.db
      .selectFrom(DATA_TABLE_NAME)
      .select(sql<string>`usr_col->>'title'`.as('title'))
      .executeTakeFirstOrThrow();
    expect(row.title).toBe('New Name');
    expect(refreshService.refreshAfterExternalValueChanges).toHaveBeenCalledWith(
      { actorId },
      {
        changes: [
          {
            tableId: expect.objectContaining({ toString: expect.any(Function) }),
            fieldIds: [expect.objectContaining({ toString: expect.any(Function) })],
          },
        ],
      }
    );
  });
});
