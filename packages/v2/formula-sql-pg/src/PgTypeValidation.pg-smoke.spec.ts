import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { sql } from 'kysely';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { Pg16TypeValidationStrategy, PgLegacyTypeValidationStrategy } from './strategies';
import {
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

describe('pg type validation (smoke)', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(container, [
      { name: 'SmokeDatetimeParse', expression: 'DATETIME_PARSE({SingleLineText})' },
      { name: 'SmokeNumeric', expression: 'VALUE({SingleLineText})' },
    ]);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('selects strategy that matches server capabilities', async () => {
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
      // PG < 16 requires the polyfill function to be present (installed via migrations in test setup).
      const result = await sql<{ ok: boolean }>`
        SELECT public.teable_try_cast_valid('1', 'numeric') as ok
      `.execute(container.db);
      expect(result.rows[0]?.ok).toBe(true);
    }
  });
});
