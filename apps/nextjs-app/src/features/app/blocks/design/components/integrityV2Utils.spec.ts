import zhTable from '@teable/common-i18n/src/locales/zh/table.json';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  getLocalizedResultMessage,
  hasExecutableRepairStatements,
  type IntegrityResult,
} from './integrityV2Utils';

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

describe('getLocalizedResultMessage', () => {
  it.each(['Base', 'Project'])(
    'localizes %s status messages during rolling upgrades',
    async (name) => {
      const i18n = createInstance();
      await i18n.init({ lng: 'zh', resources: { zh: { table: zhTable } } });
      const messages = zhTable.table.integrity.v2.message;

      for (const [status, expected] of [
        ['check stream connected', messages.baseCheckStreamConnected],
        ['repair stream connected', messages.baseRepairStreamConnected],
        ['check completed', messages.baseCheckCompleted],
        ['repair completed', messages.baseRepairCompleted],
      ]) {
        const result = { ...createResult(), message: `${name} schema integrity ${status}` };
        expect(getLocalizedResultMessage((key) => i18n.t(key as never), result)).toBe(expected);
      }
    }
  );
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
