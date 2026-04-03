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

describe('update-field: link conversion to manyMany', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('[V1 PARITY] should ignore stale multi-lookup view filter operators during list/create flows', async () => {
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('stale-filter-foreign'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleSelect', name: '是否统计', options: ['是', '否'] },
      ],
    });

    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('stale-filter-host'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    try {
      const foreignPrimaryId = foreign.fields.find((field) => field.isPrimary)?.id;
      const statusFieldId = foreign.fields.find((field) => field.name === '是否统计')?.id;
      const viewId = host.views[0]?.id;
      if (!foreignPrimaryId || !statusFieldId || !viewId) {
        throw new Error('Missing required ids for stale multi-lookup view filter test');
      }

      const tableWithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'link',
          name: '所属项目',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreign.id,
            lookupFieldId: foreignPrimaryId,
            isOneWay: false,
          },
        },
      });
      const linkField = tableWithLink.fields.find((field) => field.name === '所属项目');
      if (!linkField) {
        throw new Error('Failed to resolve link field');
      }

      const tableWithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'lookup',
          name: '是否统计',
          options: {
            linkFieldId: linkField.id,
            foreignTableId: foreign.id,
            lookupFieldId: statusFieldId,
          },
        },
      });
      const lookupField = tableWithLookup.fields.find((field) => field.name === '是否统计');
      if (!lookupField) {
        throw new Error('Failed to resolve lookup field');
      }

      const legacyFilter: LegacyFilterGroup = {
        conjunction: 'and',
        filterSet: [{ fieldId: lookupField.id, operator: 'is', value: '是' }],
      };

      await ctx.testContainer.db
        .updateTable('view')
        .set({ filter: JSON.stringify(legacyFilter) })
        .where('id', '=', viewId)
        .execute();

      const listParams = new URLSearchParams({ tableId: host.id, viewId });
      const listResponse = await fetch(
        `${ctx.baseUrl}/tables/listRecords?${listParams.toString()}`
      );
      expect(listResponse.ok).toBe(true);
      const listPayload = (await listResponse.json()) as { ok?: boolean };
      expect(listPayload.ok).toBe(true);

      await expect(ctx.createRecord(host.id, { Name: 'after-import' })).resolves.toMatchObject({
        id: expect.any(String),
      });

      const listAfterCreate = await fetch(
        `${ctx.baseUrl}/tables/listRecords?${listParams.toString()}`
      );
      expect(listAfterCreate.ok).toBe(true);
      const listAfterCreatePayload = (await listAfterCreate.json()) as { ok?: boolean };
      expect(listAfterCreatePayload.ok).toBe(true);
    } finally {
      await ctx.deleteTable(host.id).catch(() => undefined);
      await ctx.deleteTable(foreign.id).catch(() => undefined);
    }
  });
});
