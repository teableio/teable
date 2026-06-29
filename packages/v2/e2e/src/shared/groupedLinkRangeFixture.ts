import { sql } from 'kysely';
import type { SharedTestContext } from './globalTestContext';

type GroupByClause = { fieldId: string; order: 'asc' | 'desc' };
type SortClause = { fieldId: string; order: 'asc' | 'desc' };

export interface GroupedLinkRangeFixture {
  tableId: string;
  viewId: string;
  nameFieldId: string;
  platformFieldId: string;
  groupByAsc: GroupByClause[];
  expectedGroupedAscOrderIds: string[];
  recordIds: {
    github1: string;
    github2: string;
    linkedIn1: string;
    linkedIn2: string;
    x1: string;
  };
}

export interface GroupedSingleSelectRangeFixture {
  tableId: string;
  viewId: string;
  nameFieldId: string;
  storeFieldId: string;
  timeFieldId: string;
  groupByAsc: GroupByClause[];
  sortAsc: SortClause[];
  projection: string[];
  expectedVisibleOrderIds: string[];
  recordIds: {
    order1: string;
    order2: string;
    order3: string;
    order4: string;
  };
}

export const setupGroupedLinkRangeFixture = async (
  ctx: SharedTestContext,
  label: string
): Promise<GroupedLinkRangeFixture> => {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const platformTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Grouped Link Platforms ${suffix}`,
    fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });

  const platformNameFieldId = platformTable.fields.find((field) => field.isPrimary)?.id;
  if (!platformNameFieldId) {
    throw new Error('Failed to resolve platform primary field');
  }

  const githubPlatform = await ctx.createRecord(platformTable.id, {
    [platformNameFieldId]: 'Github',
  });
  const linkedInPlatform = await ctx.createRecord(platformTable.id, {
    [platformNameFieldId]: 'LinkedIn',
  });
  const xPlatform = await ctx.createRecord(platformTable.id, { [platformNameFieldId]: 'X' });

  const hostTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Grouped Link Host ${suffix}`,
    fields: [
      { name: 'Name', type: 'singleLineText', isPrimary: true },
      {
        name: 'Platform',
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: platformTable.id,
          lookupFieldId: platformNameFieldId,
          isOneWay: true,
        },
      },
    ],
    views: [{ type: 'grid' }],
  });

  const nameFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
  const platformFieldId = hostTable.fields.find((field) => field.name === 'Platform')?.id;
  const viewId = hostTable.views[0]?.id;

  if (!nameFieldId || !platformFieldId || !viewId) {
    throw new Error('Failed to resolve grouped link fixture field metadata');
  }

  const linkedIn1 = await ctx.createRecord(hostTable.id, {
    [nameFieldId]: 'LinkedIn 1',
    [platformFieldId]: { id: linkedInPlatform.id },
  });
  const github1 = await ctx.createRecord(hostTable.id, {
    [nameFieldId]: 'Github 1',
    [platformFieldId]: { id: githubPlatform.id },
  });
  const x1 = await ctx.createRecord(hostTable.id, {
    [nameFieldId]: 'X 1',
    [platformFieldId]: { id: xPlatform.id },
  });
  const github2 = await ctx.createRecord(hostTable.id, {
    [nameFieldId]: 'Github 2',
    [platformFieldId]: { id: githubPlatform.id },
  });
  const linkedIn2 = await ctx.createRecord(hostTable.id, {
    [nameFieldId]: 'LinkedIn 2',
    [platformFieldId]: { id: linkedInPlatform.id },
  });

  await ctx.drainOutbox();

  return {
    tableId: hostTable.id,
    viewId,
    nameFieldId,
    platformFieldId,
    groupByAsc: [{ fieldId: platformFieldId, order: 'asc' }],
    expectedGroupedAscOrderIds: [github1.id, github2.id, linkedIn1.id, linkedIn2.id, x1.id],
    recordIds: {
      github1: github1.id,
      github2: github2.id,
      linkedIn1: linkedIn1.id,
      linkedIn2: linkedIn2.id,
      x1: x1.id,
    },
  };
};

export const setupGroupedSingleSelectRangeFixture = async (
  ctx: SharedTestContext,
  label: string,
  options: { persistViewQuery?: boolean } = {}
): Promise<GroupedSingleSelectRangeFixture> => {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const table = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Grouped Range Orders ${suffix}`,
    fields: [
      { name: '编码', type: 'singleLineText', isPrimary: true },
      {
        name: '配送店铺',
        type: 'singleSelect',
        options: { choices: [{ name: '下沙店', color: 'greenLight1' }] },
      },
      { name: '送出时间', type: 'singleLineText' },
      { name: '日期', type: 'date' },
    ],
    views: [{ type: 'grid' }],
  });

  const viewId = table.views[0]?.id;
  const nameFieldId = table.fields.find((field) => field.isPrimary)?.id;
  const storeFieldId = table.fields.find((field) => field.name === '配送店铺')?.id;
  const timeFieldId = table.fields.find((field) => field.name === '送出时间')?.id;
  const dateFieldId = table.fields.find((field) => field.name === '日期')?.id;

  if (!viewId || !nameFieldId || !storeFieldId || !timeFieldId || !dateFieldId) {
    throw new Error('Failed to resolve grouped single-select fixture metadata');
  }

  const records = [];
  for (const name of ['加单1', '加单2', '加单3', '加单4']) {
    records.push(
      await ctx.createRecord(table.id, {
        [nameFieldId]: name,
        [storeFieldId]: '下沙店',
        [timeFieldId]: '16:30',
        [dateFieldId]: '2026-06-01',
      })
    );
  }

  const tableMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', table.id)
    .executeTakeFirst();
  const dbTableName = tableMeta?.db_table_name;
  if (!dbTableName) {
    throw new Error('Failed to resolve grouped single-select fixture storage table');
  }

  const orderColumn = `__row_${viewId}`;
  await sql`
    ALTER TABLE ${sql.table(dbTableName)}
    ADD COLUMN IF NOT EXISTS ${sql.id(orderColumn)} double precision
  `.execute(ctx.testContainer.db);
  await sql`
    UPDATE ${sql.table(dbTableName)}
    SET ${sql.ref(orderColumn)} = 5 - ${sql.ref('__auto_number')}
  `.execute(ctx.testContainer.db);

  const groupByAsc = [{ fieldId: storeFieldId, order: 'asc' }] as const;
  const sortAsc = [{ fieldId: timeFieldId, order: 'asc' }] as const;

  if (options.persistViewQuery) {
    await ctx.testContainer.db
      .updateTable('view')
      .set({
        group: JSON.stringify(groupByAsc),
        sort: JSON.stringify({ sortObjs: sortAsc, manualSort: false }),
      })
      .where('id', '=', viewId)
      .execute();
  }

  return {
    tableId: table.id,
    viewId,
    nameFieldId,
    storeFieldId,
    timeFieldId,
    groupByAsc: [...groupByAsc],
    sortAsc: [...sortAsc],
    projection: [nameFieldId, storeFieldId, timeFieldId, dateFieldId],
    expectedVisibleOrderIds: records.map((record) => record.id),
    recordIds: {
      order1: records[0].id,
      order2: records[1].id,
      order3: records[2].id,
      order4: records[3].id,
    },
  };
};
