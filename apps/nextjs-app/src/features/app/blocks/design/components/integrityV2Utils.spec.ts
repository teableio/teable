import { describe, expect, it } from 'vitest';

import { hasExecutableRepairStatements, type IntegrityResult } from './integrityV2Utils';

const createResult = (
  statements?: NonNullable<IntegrityResult['details']>['statements']
): IntegrityResult => ({
  id: 'tbl1:fld1:junction_unique:fld1',
  baseId: 'bse1',
  tableId: 'tbl1',
  tableName: 'Table',
  fieldId: 'fld1',
  fieldName: 'Link',
  ruleId: 'junction_unique:fld1',
  ruleDescription: 'Junction table unique constraint',
  status: 'success',
  message: 'Dry run: 1 statements ready',
  details: statements ? { statements } : undefined,
  required: false,
  timestamp: 1,
});

describe('hasExecutableRepairStatements', () => {
  it('returns true when dry-run results include executable SQL', () => {
    expect(
      hasExecutableRepairStatements([
        createResult([
          {
            sql: 'alter table "bse1"."junction" add constraint "uniq" unique ("a", "b")',
            parameters: [],
          },
        ]),
      ])
    ).toBe(true);
  });

  it('returns false when dry-run results do not include executable SQL', () => {
    expect(hasExecutableRepairStatements([createResult()])).toBe(false);
  });
});
