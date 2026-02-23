/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

type LegacyFilterItem = {
  fieldId: string;
  operator: string;
  value?: unknown;
};

type LegacyFilterGroup = {
  conjunction: 'and' | 'or';
  filterSet: Array<LegacyFilterItem | LegacyFilterGroup>;
};

const parseJson = <T>(raw: string | null): T | null => {
  if (raw == null) return null;
  return JSON.parse(raw) as T;
};

describe('update-field: number -> singleLineText conversion', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('[V1 PARITY] should remove invalid view filter item after number -> singleLineText conversion', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'NumberToText Filter Cleanup',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'singleSelect', name: 'Status', options: ['Todo', 'Done'] },
      ],
      views: [{ type: 'grid' }],
    });

    try {
      const viewId = table.views[0]?.id;
      const numberFieldId = table.fields.find((field) => field.name === 'Amount')?.id;
      const selectFieldId = table.fields.find((field) => field.name === 'Status')?.id;
      if (!viewId || !numberFieldId || !selectFieldId) {
        throw new Error('Missing required ids for filter cleanup test');
      }

      const legacyFilter: LegacyFilterGroup = {
        conjunction: 'and',
        filterSet: [
          { fieldId: numberFieldId, operator: 'isGreater', value: 1 },
          { fieldId: selectFieldId, operator: 'is', value: 'Todo' },
        ],
      };

      await ctx.testContainer.db
        .updateTable('view')
        .set({ filter: JSON.stringify(legacyFilter) })
        .where('id', '=', viewId)
        .execute();

      await ctx.updateField({
        tableId: table.id,
        fieldId: numberFieldId,
        field: { type: 'singleLineText' },
      });

      const updatedView = await ctx.testContainer.db
        .selectFrom('view')
        .select('filter')
        .where('id', '=', viewId)
        .executeTakeFirst();

      const nextFilter = parseJson<LegacyFilterGroup>(updatedView?.filter ?? null);
      expect(nextFilter).toEqual({
        conjunction: 'and',
        filterSet: [{ fieldId: selectFieldId, operator: 'is', value: 'Todo' }],
      });
    } finally {
      await ctx.deleteTable(table.id).catch(() => undefined);
    }
  });

  test('[V1 PARITY] should clear invalid columnMeta.statisticFunc after number -> singleLineText conversion', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'NumberToText Statistic Cleanup',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });

    try {
      const viewId = table.views[0]?.id;
      const numberFieldId = table.fields.find((field) => field.name === 'Amount')?.id;
      if (!viewId || !numberFieldId) {
        throw new Error('Missing required ids for statistic cleanup test');
      }

      const tableWithView = await ctx.getTableById(table.id);
      const gridView = tableWithView.views.find((view) => view.id === viewId);
      const currentColumnMeta =
        (gridView?.columnMeta as Record<string, Record<string, unknown>> | undefined) ?? {};

      const nextColumnMeta = {
        ...currentColumnMeta,
        [numberFieldId]: {
          ...(currentColumnMeta[numberFieldId] ?? {}),
          statisticFunc: 'sum',
        },
      };

      await ctx.testContainer.db
        .updateTable('view')
        .set({ column_meta: JSON.stringify(nextColumnMeta) })
        .where('id', '=', viewId)
        .execute();

      await ctx.updateField({
        tableId: table.id,
        fieldId: numberFieldId,
        field: { type: 'singleLineText' },
      });

      const updatedTable = await ctx.getTableById(table.id);
      const updatedView = updatedTable.views.find((view) => view.id === viewId);
      const updatedColumnMeta =
        (updatedView?.columnMeta as
          | Record<string, { statisticFunc?: string | null }>
          | undefined) ?? {};

      expect(updatedColumnMeta[numberFieldId]).toBeTruthy();
      expect(updatedColumnMeta[numberFieldId]?.statisticFunc ?? null).toBeNull();
    } finally {
      await ctx.deleteTable(table.id).catch(() => undefined);
    }
  });
});
