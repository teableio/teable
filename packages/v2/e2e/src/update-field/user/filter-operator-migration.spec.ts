/* eslint-disable @typescript-eslint/naming-convention */
import {
  getViewOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from '../../shared/globalTestContext';

type FilterItem = {
  fieldId: string;
  operator: string;
  value?: unknown;
};

type FilterSet = {
  conjunction: 'and' | 'or';
  filterSet: Array<FilterItem | FilterSet>;
};

const isFilterSet = (value: unknown): value is FilterSet =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'filterSet' in value &&
      Array.isArray((value as FilterSet).filterSet)
  );

const flattenFilterItems = (filter: unknown): FilterItem[] => {
  if (!isFilterSet(filter)) return [];
  return filter.filterSet.flatMap((entry) =>
    isFilterSet(entry) ? flattenFilterItems(entry) : [entry]
  );
};

/**
 * Sanitized structure-equivalent of T7213 / Y874:
 * a user field already used by a Grid view filter, then toggled isMultiple.
 * Customer names/ids/values are not copied.
 */
describe('update-field: user isMultiple filter operator migration T7213', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const listWithFilter = async (tableId: string, filter: unknown) => {
    const params = new URLSearchParams({
      tableId,
      fieldKeyType: FieldKeyType.Id,
      filter: JSON.stringify(filter),
    });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`ListRecords response invalid: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.records;
  };

  const setViewFilter = async (tableId: string, viewId: string, filter: unknown) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateViewFilter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, viewId, filter }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  };

  const viewFilterForField = async (tableId: string, viewId: string, fieldId: string) => {
    const params = new URLSearchParams({ tableId, viewId });
    const response = await fetch(`${ctx.baseUrl}/tables/getView?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const rawBody = await response.json();
    const parsed = getViewOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`getView failed: ${JSON.stringify(rawBody)}`);
    }
    const item = flattenFilterItems(parsed.data.data.view.filter).find(
      (entry) => entry.fieldId === fieldId
    );
    if (!item) {
      throw new Error(
        `View ${viewId} has no filter item for ${fieldId}: ${JSON.stringify(parsed.data.data.view.filter)}`
      );
    }
    return item;
  };

  it('remaps isAnyOf to hasAnyOf when converting a filtered user field to multiple', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'User Filter Single To Multiple',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    });
    const ownerFieldId = table.fields.find((field) => field.name === 'Owner')?.id ?? '';
    const viewId = table.views[0]?.id ?? '';
    expect(ownerFieldId).toBeTruthy();
    expect(viewId).toBeTruthy();

    const matched = await ctx.createRecord(table.id, {
      [ownerFieldId]: { id: TEST_USER.id, title: TEST_USER.name, email: TEST_USER.email },
    });
    await ctx.createRecord(table.id, {});

    const filter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: ownerFieldId,
          operator: 'isAnyOf',
          value: [TEST_USER.id],
        },
      ],
    };
    await setViewFilter(table.id, viewId, filter);

    const before = await listWithFilter(table.id, filter);
    expect(before.map((record) => record.id)).toEqual([matched.id]);

    await ctx.updateField({
      tableId: table.id,
      fieldId: ownerFieldId,
      field: { type: 'user', options: { isMultiple: true, shouldNotify: false } },
    });

    const persisted = await viewFilterForField(table.id, viewId, ownerFieldId);
    expect(persisted.operator).toBe('hasAnyOf');
    expect(persisted.value).toEqual([TEST_USER.id]);

    const after = await listWithFilter(table.id, {
      conjunction: 'and',
      filterSet: [persisted],
    });
    expect(after.map((record) => record.id)).toEqual([matched.id]);

    // Grid inlines the pre-convert operator (T7213 retest).
    const staleToMultiple = await listWithFilter(table.id, filter);
    expect(staleToMultiple.map((record) => record.id)).toEqual([matched.id]);
    await ctx.deleteTable(table.id);
  });

  it('remaps hasAnyOf to isAnyOf when converting a filtered user field to single', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'User Filter Multiple To Single',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'user', name: 'Assignees', options: { isMultiple: true, shouldNotify: false } },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    });
    const assigneesFieldId = table.fields.find((field) => field.name === 'Assignees')?.id ?? '';
    const viewId = table.views[0]?.id ?? '';
    expect(assigneesFieldId).toBeTruthy();
    expect(viewId).toBeTruthy();

    const matched = await ctx.createRecord(table.id, {
      [assigneesFieldId]: [{ id: TEST_USER.id, title: TEST_USER.name, email: TEST_USER.email }],
    });
    await ctx.createRecord(table.id, {});

    const filter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: assigneesFieldId,
          operator: 'hasAnyOf',
          value: ['Me'],
        },
      ],
    };
    await setViewFilter(table.id, viewId, filter);

    const before = await listWithFilter(table.id, filter);
    expect(before.map((record) => record.id)).toEqual([matched.id]);

    await ctx.updateField({
      tableId: table.id,
      fieldId: assigneesFieldId,
      field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
    });

    const persisted = await viewFilterForField(table.id, viewId, assigneesFieldId);
    expect(persisted.operator).toBe('isAnyOf');
    expect(persisted.value).toEqual(['Me']);

    const after = await listWithFilter(table.id, {
      conjunction: 'and',
      filterSet: [persisted],
    });
    expect(after.map((record) => record.id)).toEqual([matched.id]);

    // Grid inlines the pre-convert operator (T7213 retest / Y874).
    const staleToSingle = await listWithFilter(table.id, filter);
    expect(staleToSingle.map((record) => record.id)).toEqual([matched.id]);
    await ctx.deleteTable(table.id);
  });
});
