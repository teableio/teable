import { sql } from 'kysely';
import { expect, it } from 'vitest';

import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import { collectStageOutputSeedGroups, STAGE_LEDGER_TABLE } from '../ComputedStageLedger';
import { UpdateFromSelectBuilder } from '../UpdateFromSelectBuilder';
import { makeBackfillFusionTable } from './backfillFusionFixture';

/**
 * Architecture characterization: the stage frontier carries candidates, not
 * actual value changes. A value-pruning feature must introduce a separate
 * field-aware change frontier; deleting candidates would also lose processed
 * and consumed-source bookkeeping needed by continuations.
 */
it('carries a dirty candidate to the next stage even when ROUND produces no update', async () => {
  const { db, pglite } = await createPGliteDb();
  try {
    const table = makeBackfillFusionTable(['1']);
    const field = table.getFields()[1];
    const tableId = table.id().toString();
    await pglite.exec(`
      CREATE TABLE fusion (__id text PRIMARY KEY, __version integer, col_0 text, col_1 double precision);
      INSERT INTO fusion VALUES ('candidate', 10, '1.1', 1);
      CREATE TEMPORARY TABLE tmp_computed_dirty (
        table_id text NOT NULL, record_id text NOT NULL, generation integer NOT NULL DEFAULT 0,
        PRIMARY KEY (table_id, record_id)
      );
      CREATE TABLE ${STAGE_LEDGER_TABLE} (
        scope_id text NOT NULL, kind text NOT NULL, table_id text NOT NULL,
        record_id text NOT NULL, seq bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (scope_id, kind, table_id, record_id)
      );
    `);
    await sql`INSERT INTO pg_temp.tmp_computed_dirty (table_id, record_id)
      VALUES (${tableId}, 'candidate')`.execute(db);

    // The source changed, but its rounded result remains 1.
    await sql`UPDATE fusion SET col_0 = '1.2' WHERE __id = 'candidate'`.execute(db);
    const selectQuery = db
      .selectFrom('fusion')
      .select(['__id', sql`round(col_0::numeric)::double precision`.as('col_1')]);
    const compiled = new UpdateFromSelectBuilder(db)
      .build({ table, fieldIds: [field.id()], selectQuery })
      ._unsafeUnwrap();
    const update = await db.executeQuery(compiled);
    expect(Number(update.numAffectedRows ?? 0n)).toBe(0);
    expect((await pglite.query('SELECT col_1, __version FROM fusion')).rows).toEqual([
      { col_1: 1, __version: 10 },
    ]);

    const output = (
      await collectStageOutputSeedGroups(db, 'scope', [tableId], {
        seedAllThreshold: 100,
        exactIdsTotalCap: 100,
      })
    )._unsafeUnwrap();
    expect(output).toEqual({
      groups: [{ tableId, recordIds: ['candidate'] }],
      seedAllTableIds: [],
    });
  } finally {
    await db.destroy();
  }
});
