import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { FieldKeyType, ViewFilterUpdated, ViewSortUpdated } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type SortOrder = 'asc' | 'desc';
type PinyinSort = {
  fieldId: string;
  order: SortOrder;
  collation: 'zh-pinyin';
};

const rows = [
  { label: '空值' },
  { label: '有', value: '有' },
  { label: '从-1', value: '从' },
  { label: '啊', value: '啊' },
  { label: '人', value: '人' },
  { label: '吧', value: '吧' },
  { label: '从-2', value: '从' },
  { label: '的', value: '的' },
] as const;

const expectedLabels: Record<SortOrder, string[]> = {
  asc: ['空值', '啊', '吧', '从-1', '从-2', '的', '人', '有'],
  desc: ['有', '人', '的', '从-1', '从-2', '吧', '啊', '空值'],
};

describe('T8226 Y3636 PostgreSQL pinyin sorting (HTTP e2e)', () => {
  let ctx: SharedTestContext;
  const cleanupTableIds: string[] = [];

  let textTableId: string;
  let textNameFieldId: string;
  let textValueFieldId: string;

  let linkTableId: string;
  let linkNameFieldId: string;
  let linkFieldId: string;
  let linkViewId: string;

  const drainOutbox = async (rounds = 10) => {
    for (let index = 0; index < rounds; index += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listPage = async (input: {
    tableId: string;
    offset: number;
    limit: number;
    sort?: PinyinSort[];
    viewId?: string;
  }) => {
    await drainOutbox();

    const params = new URLSearchParams({
      tableId: input.tableId,
      fieldKeyType: FieldKeyType.Id,
      offset: String(input.offset),
      limit: String(input.limit),
      includeTotal: 'true',
    });
    if (input.sort) params.set('sort', JSON.stringify(input.sort));
    if (input.viewId) params.set('viewId', input.viewId);

    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);

    const parsed = listTableRecordsOkResponseSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(body)).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Invalid listRecords response: ${JSON.stringify(body)}`);
    }
    return parsed.data.data;
  };

  const readOffsetPages = async (input: {
    tableId: string;
    nameFieldId: string;
    sort?: PinyinSort[];
    viewId?: string;
  }) => {
    const limit = 4;
    const first = await listPage({ ...input, offset: 0, limit });
    const second = await listPage({ ...input, offset: limit, limit });

    expect(first.pagination).toMatchObject({ total: rows.length, offset: 0, limit, hasMore: true });
    expect(second.pagination).toMatchObject({
      total: rows.length,
      offset: limit,
      limit,
      hasMore: false,
    });

    const records = [...first.records, ...second.records];
    expect(records).toHaveLength(rows.length);
    return {
      ids: records.map((record) => record.id),
      labels: records.map((record) => record.fields[input.nameFieldId]),
      pageBoundaryLabels: [
        first.records.at(-1)?.fields[input.nameFieldId],
        second.records.at(0)?.fields[input.nameFieldId],
      ],
    };
  };

  const updateSavedPinyinSort = async (order: SortOrder) => {
    const sortItem: PinyinSort = { fieldId: linkFieldId, order, collation: 'zh-pinyin' };
    const response = await fetch(`${ctx.baseUrl}/tables/updateViewSort`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: linkTableId,
        viewId: linkViewId,
        sort: { sortObjs: [sortItem], manualSort: false },
      }),
    });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ ok: true });
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);

    const textTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8226 Pinyin Text',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        { name: 'Chinese Text', type: 'singleLineText' },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    });
    textTableId = textTable.id;
    cleanupTableIds.push(textTableId);
    textNameFieldId = textTable.fields.find((field) => field.isPrimary)?.id ?? '';
    textValueFieldId = textTable.fields.find((field) => field.name === 'Chinese Text')?.id ?? '';
    if (!textNameFieldId || !textValueFieldId) {
      throw new Error('Text pinyin fixture is incomplete');
    }
    await ctx.createRecords(
      textTableId,
      rows.map((row) => ({
        fields: {
          [textNameFieldId]: row.label,
          ...('value' in row ? { [textValueFieldId]: row.value } : {}),
        },
      }))
    );

    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8226 Pinyin Link Source',
      fields: [{ name: 'Chinese Title', type: 'singleLineText', isPrimary: true }],
      views: [{ type: 'grid', name: 'Grid' }],
    });
    cleanupTableIds.push(sourceTable.id);
    const sourceTitleFieldId = sourceTable.fields.find((field) => field.isPrimary)?.id ?? '';
    if (!sourceTitleFieldId) throw new Error('Link source fixture is incomplete');
    const sourceValues = ['有', '从', '啊', '人', '吧', '的'] as const;
    const sourceRecords = await ctx.createRecords(
      sourceTable.id,
      sourceValues.map((value) => ({ fields: { [sourceTitleFieldId]: value } }))
    );
    const sourceRecordByValue = new Map(
      sourceValues.map((value, index) => [value, sourceRecords[index]] as const)
    );

    const linkTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8226 Pinyin ManyOne Link',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        {
          name: 'Chinese Link',
          type: 'link',
          options: {
            relationship: 'manyOne',
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceTitleFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid', name: 'Pinyin View' }],
    });
    linkTableId = linkTable.id;
    cleanupTableIds.push(linkTableId);
    linkNameFieldId = linkTable.fields.find((field) => field.isPrimary)?.id ?? '';
    linkFieldId = linkTable.fields.find((field) => field.name === 'Chinese Link')?.id ?? '';
    linkViewId = linkTable.views[0]?.id ?? '';
    if (!linkNameFieldId || !linkFieldId || !linkViewId) {
      throw new Error('ManyOne pinyin fixture is incomplete');
    }

    await ctx.createRecords(
      linkTableId,
      rows.map((row) => {
        const linkedRecord = 'value' in row ? sourceRecordByValue.get(row.value) : undefined;
        return {
          fields: {
            [linkNameFieldId]: row.label,
            ...(linkedRecord ? { [linkFieldId]: { id: linkedRecord.id } } : {}),
          },
        };
      })
    );
    await drainOutbox();
  }, 120_000);

  afterAll(async () => {
    for (const tableId of cleanupTableIds.reverse()) {
      await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
    }
  });

  it.each(['asc', 'desc'] as const)(
    'sorts Chinese text %s by explicit zh-pinyin collation with stable null/duplicate offset pages',
    async (order) => {
      const request = {
        tableId: textTableId,
        nameFieldId: textNameFieldId,
        sort: [{ fieldId: textValueFieldId, order, collation: 'zh-pinyin' as const }],
      };

      const firstPass = await readOffsetPages(request);
      const secondPass = await readOffsetPages(request);

      expect(firstPass.labels).toEqual(expectedLabels[order]);
      expect(firstPass.pageBoundaryLabels).toEqual(['从-1', '从-2']);
      expect(secondPass.ids).toEqual(firstPass.ids);
    }
  );

  it('persists and returns zh-pinyin collation in a saved View sort', async () => {
    await updateSavedPinyinSort('asc');

    const params = new URLSearchParams({ tableId: linkTableId, viewId: linkViewId });
    const response = await fetch(`${ctx.baseUrl}/tables/getView?${params.toString()}`);
    const body: unknown = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        view: {
          id: linkViewId,
          sort: {
            sortObjs: [{ fieldId: linkFieldId, order: 'asc', collation: 'zh-pinyin' }],
            manualSort: false,
          },
        },
      },
    });
  });

  it.each(['asc', 'desc'] as const)(
    'sorts a manyOne link %s through saved zh-pinyin View state with stable offset pages',
    async (order) => {
      await updateSavedPinyinSort(order);
      const request = {
        tableId: linkTableId,
        nameFieldId: linkNameFieldId,
        viewId: linkViewId,
      };

      const firstPass = await readOffsetPages(request);
      const secondPass = await readOffsetPages(request);

      expect(firstPass.labels).toEqual(expectedLabels[order]);
      expect(firstPass.pageBoundaryLabels).toEqual(['从-1', '从-2']);
      expect(secondPass.ids).toEqual(firstPass.ids);
    }
  );

  it('keeps a saved view readable when both ends of a two-way self-link become multiple', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8226 Self Link Conversion',
      fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
      views: [{ type: 'grid', name: 'Grid' }],
    });
    cleanupTableIds.push(table.id);
    const nameFieldId = table.fields.find((field) => field.isPrimary)!.id;
    const viewId = table.views[0]!.id;
    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        name: 'Related',
        type: 'link',
        options: {
          relationship: 'oneOne',
          foreignTableId: table.id,
          lookupFieldId: nameFieldId,
          isOneWay: false,
        },
      },
    });
    const link = withLink.fields.find((field) => field.name === 'Related');
    if (link?.type !== 'link' || !link.options.symmetricFieldId) {
      throw new Error('Missing two-way self-link fixture');
    }
    const symmetricFieldId = link.options.symmetricFieldId;
    const records = await ctx.createRecords(table.id, [
      { fields: { [nameFieldId]: '啊' } },
      { fields: { [nameFieldId]: '吧' } },
      { fields: { [nameFieldId]: '有' } },
    ]);
    const originalSort: PinyinSort[] = [
      { fieldId: link.id, order: 'desc', collation: 'zh-pinyin' },
      { fieldId: symmetricFieldId, order: 'asc', collation: 'zh-pinyin' },
      { fieldId: nameFieldId, order: 'asc', collation: 'zh-pinyin' },
    ];
    const saved = await client.tables.updateViewSort({
      tableId: table.id,
      viewId,
      sort: { sortObjs: originalSort, manualSort: false },
    });
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    const eventOffset = ctx.testContainer.eventBus.events().length;
    await ctx.updateField({
      tableId: table.id,
      fieldId: link.id,
      field: {
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: table.id,
          lookupFieldId: nameFieldId,
          isOneWay: false,
        },
      },
    });

    const expectedSort = {
      sortObjs: [
        { fieldId: link.id, order: 'desc' },
        { fieldId: symmetricFieldId, order: 'asc' },
        originalSort[2],
      ],
      manualSort: false,
    };
    const view = await client.tables.getView({ tableId: table.id, viewId });
    expect(view.ok, JSON.stringify(view)).toBe(true);
    if (!view.ok) throw new Error(view.error.message);
    expect(view.data.view.sort).toEqual(expectedSort);
    const snapshots = await client.tables.getViewSnapshots({
      tableId: table.id,
      viewIds: [viewId],
    });
    expect(snapshots.ok, JSON.stringify(snapshots)).toBe(true);
    if (!snapshots.ok) throw new Error(snapshots.error.message);
    expect(snapshots.data.snapshots[0]?.data.sort).toEqual(expectedSort);

    const sortEvents = ctx.testContainer.eventBus
      .events()
      .slice(eventOffset)
      .filter((event): event is ViewSortUpdated => event instanceof ViewSortUpdated);
    expect(sortEvents).toHaveLength(1);
    expect(sortEvents[0]?.previousSort).toEqual({ sortObjs: originalSort, manualSort: false });
    expect(sortEvents[0]?.nextSort).toEqual(expectedSort);
    expect(sortEvents[0]?.newVersion).toBe(snapshots.data.snapshots[0]?.v);
    const afterTable = await ctx.getTableById(table.id);
    for (const fieldId of [link.id, symmetricFieldId]) {
      expect(afterTable.fields.find((field) => field.id === fieldId)).toMatchObject({
        type: 'link',
        options: { relationship: 'manyMany' },
      });
    }
    const page = await listPage({ tableId: table.id, viewId, offset: 0, limit: 10 });
    expect(page.records).toHaveLength(3);
    expect(page.records.map((record) => record.id)).toEqual(records.map((record) => record.id));
    expect(page.records.map((record) => record.fields[nameFieldId])).toEqual(['啊', '吧', '有']);
  });

  it('does not restore an invalid filter when collation is cleaned after text-to-number conversion', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8226 Filter And Sort Conversion',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        { name: 'Amount', type: 'singleLineText' },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    });
    cleanupTableIds.push(table.id);
    const nameFieldId = table.fields.find((field) => field.isPrimary)!.id;
    const amountFieldId = table.fields.find((field) => field.name === 'Amount')!.id;
    const viewId = table.views[0]!.id;
    const records = await ctx.createRecords(table.id, [
      { fields: { [nameFieldId]: 'keep', [amountFieldId]: '2' } },
      { fields: { [nameFieldId]: 'keep', [amountFieldId]: '10' } },
      { fields: { [nameFieldId]: 'drop', [amountFieldId]: '99' } },
    ]);
    const retainedCondition = { fieldId: nameFieldId, operator: 'is' as const, value: 'keep' };
    const partialCondition = {
      fieldId: nameFieldId,
      operator: 'isAnyOf' as const,
      value: null,
    };
    const filtered = await client.tables.updateViewFilter({
      tableId: table.id,
      viewId,
      filter: {
        conjunction: 'and',
        filterSet: [
          { fieldId: amountFieldId, operator: 'contains', value: '1' },
          retainedCondition,
          partialCondition,
        ],
      },
    });
    expect(filtered.ok, JSON.stringify(filtered)).toBe(true);
    const originalSort: PinyinSort[] = [
      { fieldId: amountFieldId, order: 'desc', collation: 'zh-pinyin' },
      { fieldId: nameFieldId, order: 'asc', collation: 'zh-pinyin' },
    ];
    const saved = await client.tables.updateViewSort({
      tableId: table.id,
      viewId,
      sort: { sortObjs: originalSort, manualSort: false },
    });
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    const before = await listPage({ tableId: table.id, viewId, offset: 0, limit: 10 });
    expect(before.records.map((record) => record.id)).toEqual([records[1]!.id]);
    const eventOffset = ctx.testContainer.eventBus.events().length;
    await ctx.updateField({ tableId: table.id, fieldId: amountFieldId, field: { type: 'number' } });

    const expectedFilter = {
      conjunction: 'and' as const,
      filterSet: [retainedCondition, partialCondition],
    };
    const expectedSort = {
      sortObjs: [{ fieldId: amountFieldId, order: 'desc' }, originalSort[1]],
      manualSort: false,
    };
    const view = await client.tables.getView({ tableId: table.id, viewId });
    expect(view.ok, JSON.stringify(view)).toBe(true);
    if (!view.ok) throw new Error(view.error.message);
    expect(view.data.view.filter).toEqual(expectedFilter);
    expect(view.data.view.sort).toEqual(expectedSort);
    const snapshots = await client.tables.getViewSnapshots({
      tableId: table.id,
      viewIds: [viewId],
    });
    expect(snapshots.ok, JSON.stringify(snapshots)).toBe(true);
    if (!snapshots.ok) throw new Error(snapshots.error.message);
    expect(snapshots.data.snapshots[0]?.data).toMatchObject({
      filter: expectedFilter,
      sort: expectedSort,
    });
    const conversionEvents = ctx.testContainer.eventBus.events().slice(eventOffset);
    const filterEvent = conversionEvents.find(
      (event): event is ViewFilterUpdated => event instanceof ViewFilterUpdated
    );
    expect(filterEvent?.nextFilter).toEqual(expectedFilter);
    const sortEvent = conversionEvents.find(
      (event): event is ViewSortUpdated => event instanceof ViewSortUpdated
    );
    expect(sortEvent?.nextSort).toEqual(expectedSort);
    expect(sortEvent?.newVersion).toBe(snapshots.data.snapshots[0]?.v);
    const page = await listPage({ tableId: table.id, viewId, offset: 0, limit: 10 });
    expect(page.records.map((record) => record.id)).toEqual([records[1]!.id, records[0]!.id]);
    expect(page.records.map((record) => record.fields[amountFieldId])).toEqual([10, 2]);
    const allRecords = await listPage({ tableId: table.id, offset: 0, limit: 10 });
    expect(
      allRecords.records.find((record) => record.id === records[2]!.id)?.fields[amountFieldId]
    ).toBe(99);
  });
});
