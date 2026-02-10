import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Pg16TypeValidationStrategy, PgLegacyTypeValidationStrategy } from './strategies';
import {
  createFormulaTestTable,
  executeFormulaAsText,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const describePgIntegration = process.env.TEABLE_V2_RUN_PG_INTEGRATION ? describe : describe.skip;

describePgIntegration('pg type validation (integration)', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createV2NodeTestContainer();
    testTable = await createFormulaTestTable(container, [
      { name: 'SmokeDatetimeParse', expression: 'DATETIME_PARSE({SingleLineText})' },
      { name: 'SmokeNumeric', expression: 'VALUE({SingleLineText})' },
      { name: 'SmokeJson', expression: 'ARRAYJOIN({LookupType})' },
    ]);
  });

  afterAll(async () => {
    await container?.dispose();
  });

  it('executes translated SQL without version-specific failures', async () => {
    const hasPgInputIsValid = await (async () => {
      try {
        await sql`SELECT pg_input_is_valid('1', 'numeric')`.execute(container.db);
        return true;
      } catch {
        return false;
      }
    })();

    if (hasPgInputIsValid) {
      expect(testTable.translator.typeValidationStrategy).toBeInstanceOf(
        Pg16TypeValidationStrategy
      );
    } else {
      expect(testTable.translator.typeValidationStrategy).toBeInstanceOf(
        PgLegacyTypeValidationStrategy
      );
      const polyfill = await sql<{ ok: boolean }>`
        SELECT public.teable_try_cast_valid('1', 'numeric') as ok
      `.execute(container.db);
      expect(polyfill.rows[0]?.ok).toBe(true);
    }

    const numeric = await executeFormulaAsText(testTable, 'SmokeNumeric');
    expect(numeric).not.toBeNull();

    const dt = await executeFormulaAsText(testTable, 'SmokeDatetimeParse');
    // DATETIME_PARSE on non-datetime text may yield NULL; the smoke check is "no crash".
    expect(dt === null || typeof dt === 'string').toBe(true);

    const json = await executeFormulaAsText(testTable, 'SmokeJson');
    expect(json === null || typeof json === 'string').toBe(true);
  });
});
