/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getV2NodeTestContainer,
  setV2NodeTestContainer,
} from '../../integration/testkit/v2NodeTestContainer';
import { buildValueSeekPredicate, type CursorSeekKey } from './listRecordsCursor';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

const ROWS = 5000;
const PAGE = 50;
const SKIP = 4000;
const SCHEMA = 'cursorpath';
const TABLE = `${SCHEMA}.tbl_cursor_access_path`;
const ROW_ORDER_COLUMN = '__row_viwcursorpath0000';

const maxScannedRows = (plan: unknown): number => {
  if (!plan || typeof plan !== 'object') {
    return 0;
  }
  let highest = 0;
  if ('Actual Rows' in plan && typeof plan['Actual Rows'] === 'number') {
    // Rows the node produced plus the ones it discarded: a seek that never reaches the
    // index would still emit one page while scanning everything up to the position.
    const removed =
      'Rows Removed by Filter' in plan && typeof plan['Rows Removed by Filter'] === 'number'
        ? plan['Rows Removed by Filter']
        : 0;
    const loops =
      'Actual Loops' in plan && typeof plan['Actual Loops'] === 'number' ? plan['Actual Loops'] : 1;
    highest = (plan['Actual Rows'] + removed) * Math.max(loops, 1);
  }
  if ('Plans' in plan && Array.isArray(plan.Plans)) {
    for (const child of plan.Plans) {
      highest = Math.max(highest, maxScannedRows(child));
    }
  }
  return highest;
};

const hasIndexCondition = (plan: unknown): boolean => {
  if (!plan || typeof plan !== 'object') {
    return false;
  }
  if ('Index Cond' in plan) {
    return true;
  }
  return 'Plans' in plan && Array.isArray(plan.Plans)
    ? plan.Plans.some((child) => hasIndexCondition(child))
    : false;
};

const explainPlan = async (db: Kysely<DynamicDb>, query: RawBuilder<unknown>): Promise<unknown> => {
  const result = await sql<{ 'QUERY PLAN': unknown }>`
    EXPLAIN (ANALYZE, FORMAT JSON) ${query}
  `.execute(db);
  const raw = result.rows[0]?.['QUERY PLAN'];
  const root = Array.isArray(raw) ? raw[0] : raw;
  if (root && typeof root === 'object' && 'Plan' in root) {
    return root.Plan;
  }
  return root;
};

/**
 * The cursor exists so a page stops paying for the rows it skips: the seek has to start
 * the ordered index scan at the cursor's position instead of walking to it. Asserted as
 * rows read rather than milliseconds, so it holds on any machine.
 */
describe('cursor seek access path (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it('reads one page from the cursor position instead of every skipped row', async () => {
    const { container } = getV2NodeTestContainer();
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(SCHEMA)}`.execute(db);
    await sql`DROP TABLE IF EXISTS ${sql.table(TABLE)}`.execute(db);
    await sql`
      CREATE TABLE ${sql.table(TABLE)} (
        __id text PRIMARY KEY,
        __auto_number integer NOT NULL,
        ${sql.id(ROW_ORDER_COLUMN)} double precision,
        col_name text
      )
    `.execute(db);
    await sql`
      INSERT INTO ${sql.table(TABLE)}
      SELECT 'rec' || lpad(i::text, 20, '0'), i, i * 2.0 + (i % 7) / 100.0, 'v' || lpad(i::text, 6, '0')
      FROM generate_series(1, ${ROWS}) AS i
    `.execute(db);
    // Production shapes: the lazily created view row-order index is single column, and a
    // sorted scalar field carries its own index.
    await sql`CREATE INDEX idx_cursor_path_row ON ${sql.table(TABLE)} (${sql.id(ROW_ORDER_COLUMN)})`.execute(
      db
    );
    await sql`CREATE INDEX idx_cursor_path_name ON ${sql.table(TABLE)} (col_name)`.execute(db);
    await sql`ANALYZE ${sql.table(TABLE)}`.execute(db);

    const cases: Array<{
      label: string;
      order: RawBuilder<unknown>;
      keys: CursorSeekKey[];
      values: Array<string | number>;
    }> = [
      {
        label: 'view row order',
        order: sql`${sql.id(ROW_ORDER_COLUMN)} asc, __auto_number asc`,
        keys: [
          { column: ROW_ORDER_COLUMN, direction: 'asc', matchV1Nulls: true },
          { column: '__auto_number', direction: 'asc', matchV1Nulls: false },
        ],
        values: [SKIP * 2 + 1, SKIP + 1],
      },
      {
        label: 'text field order',
        order: sql`col_name asc, __auto_number asc`,
        keys: [
          { column: 'col_name', direction: 'asc', matchV1Nulls: true },
          { column: '__auto_number', direction: 'asc', matchV1Nulls: false },
        ],
        values: [`v${String(SKIP + 1).padStart(6, '0')}`, SKIP + 1],
      },
    ];

    for (const testCase of cases) {
      const predicate = buildValueSeekPredicate('t', testCase.keys, testCase.values);
      const cursorPlan = await explainPlan(
        db,
        sql`SELECT t.__id FROM ${sql.table(TABLE)} AS t
            WHERE ${predicate}
            ORDER BY ${testCase.order} LIMIT ${PAGE}`
      );
      const offsetPlan = await explainPlan(
        db,
        sql`SELECT t.__id FROM ${sql.table(TABLE)} AS t
            ORDER BY ${testCase.order} LIMIT ${PAGE} OFFSET ${SKIP}`
      );

      expect(hasIndexCondition(cursorPlan), `${testCase.label}: seek reached the index`).toBe(true);
      expect(maxScannedRows(cursorPlan), `${testCase.label}: cursor plan`).toBeLessThanOrEqual(
        PAGE + 2
      );
      expect(maxScannedRows(offsetPlan), `${testCase.label}: offset plan`).toBeGreaterThan(SKIP);
    }
  });
});
