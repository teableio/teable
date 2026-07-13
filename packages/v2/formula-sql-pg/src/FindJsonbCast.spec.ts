/**
 * Regression: FIND/SEARCH must never emit position(jsonb, …).
 * Customer dead-letter: function pg_catalog.position(jsonb, unknown) does not exist
 */
import { describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

describe('FIND/SEARCH text cast for jsonb-safe POSITION', () => {
  it('FIND SQL always casts both POSITION operands to text', async () => {
    const container = await createFormulaTestContainer();
    try {
      const table = await createFormulaTestTable(container, [
        {
          name: 'FindMultiSelect',
          expression: 'FIND("#92D050", {MultipleSelect})',
        },
        {
          name: 'SearchMultiSelect',
          expression: 'SEARCH("x", {MultipleSelect})',
        },
      ]);

      const findCtx = await buildFormulaSnapshotContext(table, 'FindMultiSelect');
      expect(findCtx.sql.toUpperCase()).toContain('POSITION');
      // Both operands must be cast — prevents position(jsonb, unknown)
      // Shape: POSITION(((…)::text) IN (((…)::text))
      expect(findCtx.sql).toMatch(
        /POSITION\s*\(\s*\(\(.+?\)::text\)\s+IN\s+\(\(.+?\)::text\)\s*\)/is
      );
      // Multi-select storage is jsonb; stringify path + outer ::text must remain
      expect(findCtx.sql).toContain('::jsonb');
      expect(findCtx.sql).toContain('jsonb_array_elements');

      const searchCtx = await buildFormulaSnapshotContext(table, 'SearchMultiSelect');
      expect(searchCtx.sql.toUpperCase()).toContain('POSITION');
      expect(searchCtx.sql).toMatch(/::text/i);

      // Evaluating against real multi-select data must not throw
      expect(findCtx.result === null || typeof findCtx.result === 'string').toBe(true);
      expect(searchCtx.result === null || typeof searchCtx.result === 'string').toBe(true);
    } finally {
      await container.dispose();
    }
  }, 60_000);
});
