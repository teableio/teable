import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import type { DynamicDB } from '../../query-builder';
import { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import type { ComputedCellLimitRejection } from '../ComputedFieldUpdater';

type PGliteDb = Awaited<ReturnType<typeof createPGliteDb>>;

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const DATA_TABLE_NAME = `${BASE_ID}.${TABLE_ID}`;
const RECORD_A = `rec${'a'.repeat(16)}`;
const RECORD_B = `rec${'b'.repeat(16)}`;

const createLogger = () => {
  const logger = {
    child: () => logger,
    scope: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return logger;
};

const rejection = (
  overrides: Partial<ComputedCellLimitRejection> & Pick<ComputedCellLimitRejection, 'recordId'>
): ComputedCellLimitRejection => ({
  tableId: TABLE_ID,
  fieldId: `fld${'c'.repeat(16)}`,
  column: 'col_lookup',
  columnType: 'jsonb',
  oldValue: null,
  attempted: 999,
  max: 1,
  ...overrides,
});

/**
 * Runs the private revert against real Postgres (pglite) semantics: the
 * RETURNING old values arrive as driver-parsed JS values, so jsonb columns
 * must round-trip through JSON text — binding a JS array or bare string
 * directly would be rejected as invalid jsonb input.
 */
describe('revertOversizedComputedCells against pglite', () => {
  let data: PGliteDb;
  let db: Kysely<DynamicDB>;
  // Constructor collaborators are unused by the revert path.
  let updater: ComputedFieldUpdater;

  beforeAll(async () => {
    data = await createPGliteDb();
    db = data.db as unknown as Kysely<DynamicDB>;

    await data.db.schema.createSchema(BASE_ID).execute();
    await sql`
      create table ${sql.table(DATA_TABLE_NAME)} (
        "__id" text primary key,
        "col_lookup" jsonb,
        "col_text" text
      )
    `.execute(data.db);
    await sql`
      create temporary table pg_temp.tmp_computed_dirty (
        table_id text not null,
        record_id text not null,
        generation integer not null default 0,
        primary key (table_id, record_id)
      )
    `.execute(data.db);
    await sql`
      insert into ${sql.table(DATA_TABLE_NAME)} ("__id", "col_lookup", "col_text")
      values
        (${RECORD_A}, ${JSON.stringify(['huge-a', 'huge-b'])}::jsonb, 'huge-text'),
        (${RECORD_B}, ${JSON.stringify('huge-scalar')}::jsonb, 'huge-text-b')
    `.execute(data.db);

    updater = new ComputedFieldUpdater(
      {} as never,
      createLogger() as never,
      db as never,
      undefined,
      {} as never,
      {} as never
    );
  });

  afterAll(async () => {
    await data.db.destroy();
  });

  const revert = (rejections: ComputedCellLimitRejection[]) =>
    (
      updater as unknown as {
        revertOversizedComputedCells: (
          db: Kysely<DynamicDB>,
          tableName: string,
          tableId: string,
          stepLevel: number,
          rejections: ReadonlyArray<ComputedCellLimitRejection>
        ) => Promise<{ isOk(): boolean }>;
      }
    ).revertOversizedComputedCells(db, DATA_TABLE_NAME, TABLE_ID, 0, rejections);

  it('reverts jsonb array, jsonb scalar string, jsonb null, and text old values', async () => {
    const result = await revert([
      rejection({ recordId: RECORD_A, oldValue: ['a', 'b'] }),
      rejection({ recordId: RECORD_B, oldValue: 'plain old string' }),
      rejection({
        recordId: RECORD_A,
        column: 'col_text',
        columnType: 'text',
        oldValue: 'short',
      }),
      rejection({
        recordId: RECORD_B,
        column: 'col_text',
        columnType: 'text',
        oldValue: undefined,
      }),
    ]);
    expect(result.isOk()).toBe(true);

    const rows = await sql<{
      __id: string;
      col_lookup: unknown;
      col_text: string | null;
    }>`select "__id", "col_lookup", "col_text" from ${sql.table(
      DATA_TABLE_NAME
    )} order by "__id"`.execute(data.db);
    expect(rows.rows).toEqual([
      { __id: RECORD_A, col_lookup: ['a', 'b'], col_text: 'short' },
      { __id: RECORD_B, col_lookup: 'plain old string', col_text: null },
    ]);
  });

  it('re-dirties rejected records for the continuation stage', async () => {
    const dirty = await sql<{ table_id: string; record_id: string }>`
      select table_id, record_id from pg_temp.tmp_computed_dirty order by record_id
    `.execute(data.db);
    expect(dirty.rows).toEqual([
      { table_id: TABLE_ID, record_id: RECORD_A },
      { table_id: TABLE_ID, record_id: RECORD_B },
    ]);
  });

  it('reverts a second batch onto jsonb null without error', async () => {
    const result = await revert([rejection({ recordId: RECORD_A, oldValue: null })]);
    expect(result.isOk()).toBe(true);
    const rows = await sql<{ col_lookup: unknown }>`
      select "col_lookup" from ${sql.table(DATA_TABLE_NAME)} where "__id" = ${RECORD_A}
    `.execute(data.db);
    expect(rows.rows[0]?.col_lookup).toBeNull();
  });
});
