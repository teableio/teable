import zhSdk from '@teable/common-i18n/src/locales/zh/sdk.json';
import zhTable from '@teable/common-i18n/src/locales/zh/table.json';
import { HttpError } from '@teable/core';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  getErrorMessage,
  getLocalizedResultMessage,
  getLocalizedRuleDescription,
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

describe('getLocalizedRuleDescription', () => {
  const translate = async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh', resources: { zh: { table: zhTable } } });
    return (key: string, options?: Record<string, unknown>) => i18n.t(key as never, options);
  };

  // Every rule-id prefix the v2 schema checker and metadata repairer emit.
  it.each([
    'column:fld1',
    'not_null:fld1',
    'fk:fld1:__fk',
    'junction_fk:fld1:self',
    'system_not_null:__id',
    'system_primary_key:__auto_number',
    'table_exists',
    'system_orphaned_link_storage',
    'table_missing_primary_field',
    'meta:reference',
    'select_options:fld1',
    'default_backfill:fld1',
    'cond_match_index:fld1:fld2',
  ])('names rule %s in the user language instead of the backend description', async (ruleId) => {
    const t = await translate();
    const label = getLocalizedRuleDescription(t, {
      ...createResult(),
      ruleId,
      ruleDescription: 'Backend english description',
    });
    expect(label).not.toBe('Backend english description');
    expect(label).not.toMatch(/^table\./);
  });

  it('keeps the backend description for rule families it does not know', async () => {
    const t = await translate();
    expect(
      getLocalizedRuleDescription(t, {
        ...createResult(),
        ruleId: 'future_rule:fld1',
        ruleDescription: 'Future rule',
      })
    ).toBe('Future rule');
  });
});

describe('server error localization', () => {
  const createI18n = async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'zh', resources: { zh: { table: zhTable, sdk: zhSdk } } });
    return (key: string, options?: Record<string, unknown>) => i18n.t(key as never, options);
  };

  it('prefers the translation a streamed result carries over its English message', async () => {
    const t = await createI18n();
    const result = {
      ...createResult(),
      status: 'error' as const,
      message: 'Invalid TableName',
      localization: { i18nKey: 'httpErrors.table.nameRequired' },
    };
    expect(getLocalizedResultMessage(t, result)).toBe(zhSdk.httpErrors.table.nameRequired);
  });

  it('translates a rejected stream request and falls back to its message', async () => {
    const t = await createI18n();
    const localized = new HttpError(
      {
        message: 'Invalid TableName',
        data: { localization: { i18nKey: 'httpErrors.table.nameRequired' } },
      },
      400
    );
    expect(getErrorMessage(localized, 'fallback', t)).toBe(zhSdk.httpErrors.table.nameRequired);
    expect(getErrorMessage(new Error('boom'), 'fallback', t)).toBe('boom');
    expect(getErrorMessage('x', 'fallback', t)).toBe('fallback');
  });
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
