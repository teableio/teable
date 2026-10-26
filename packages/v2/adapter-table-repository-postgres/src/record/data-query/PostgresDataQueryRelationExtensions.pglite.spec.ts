import {
  ActorId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  type ITablePersistenceDTO,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import {
  DataQueryDefinition,
  DataQueryRelationBinding,
  type DataQueryRelationPlan,
} from '@teable/v2-data-query';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

const rootTableId = `tbl${'a'.repeat(16)}`;
const targetTableId = `tbl${'b'.repeat(16)}`;
const departmentTableId = `tbl${'c'.repeat(16)}`;
const baseId = `bse${'a'.repeat(16)}`;

const titleId = `fld${'a'.repeat(16)}`;
const ownerId = `fld${'b'.repeat(16)}`;
const itemsId = `fld${'c'.repeat(16)}`;
const tagsId = `fld${'d'.repeat(16)}`;
const rootDueId = `fld${'e'.repeat(16)}`;
const budgetId = `fld${'f'.repeat(16)}`;
const targetNameId = `fld${'g'.repeat(16)}`;
const amountId = `fld${'h'.repeat(16)}`;
const targetDueId = `fld${'i'.repeat(16)}`;
const departmentLinkId = `fld${'j'.repeat(16)}`;
const departmentNameId = `fld${'k'.repeat(16)}`;

const rootPhysical = 'pglite_p15_root';
const targetPhysical = 'pglite_p15_target';
const departmentPhysical = 'pglite_p15_department';
const junctionTags = 'junction_p15_tags';

const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
const mapper = new DefaultTableMapper();

const rootDto = (): ITablePersistenceDTO => ({
  id: rootTableId,
  baseId,
  name: 'P1.5 root',
  dbTableName: `public.${rootPhysical}`,
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', dbFieldName: 'title', type: 'singleLineText' },
    { id: rootDueId, name: 'Due', dbFieldName: 'due', type: 'date' },
    { id: budgetId, name: 'Budget', dbFieldName: 'budget', type: 'number' },
    {
      id: ownerId,
      name: 'Owner',
      dbFieldName: 'owner',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: targetTableId,
        lookupFieldId: targetNameId,
        isOneWay: true,
        fkHostTableName: `public.${rootPhysical}`,
        selfKeyName: '__id',
        foreignKeyName: 'fk_owner',
      },
    },
    {
      id: itemsId,
      name: 'Items',
      dbFieldName: 'items',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: targetTableId,
        lookupFieldId: targetNameId,
        isOneWay: false,
        fkHostTableName: `public.${targetPhysical}`,
        selfKeyName: 'fk_items',
        foreignKeyName: '__id',
      },
    },
    {
      id: tagsId,
      name: 'Tags',
      dbFieldName: 'tags',
      type: 'link',
      options: {
        relationship: 'manyMany',
        foreignTableId: targetTableId,
        lookupFieldId: targetNameId,
        isOneWay: false,
        fkHostTableName: `public.${junctionTags}`,
        selfKeyName: '__fk_tags',
        foreignKeyName: '__fk_tag_target',
      },
    },
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const targetDto = (): ITablePersistenceDTO => ({
  id: targetTableId,
  baseId,
  name: 'P1.5 target',
  dbTableName: `public.${targetPhysical}`,
  primaryFieldId: targetNameId,
  fields: [
    { id: targetNameId, name: 'Name', dbFieldName: 'name', type: 'singleLineText' },
    { id: amountId, name: 'Amount', dbFieldName: 'amount', type: 'number' },
    { id: targetDueId, name: 'Due', dbFieldName: 'due', type: 'date' },
    {
      id: departmentLinkId,
      name: 'Department',
      dbFieldName: 'department',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: departmentTableId,
        lookupFieldId: departmentNameId,
        isOneWay: true,
        fkHostTableName: `public.${targetPhysical}`,
        selfKeyName: '__id',
        foreignKeyName: 'fk_department',
      },
    },
  ],
  views: [{ id: `viw${'b'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const departmentDto = (): ITablePersistenceDTO => ({
  id: departmentTableId,
  baseId,
  name: 'P1.5 department',
  dbTableName: `public.${departmentPhysical}`,
  primaryFieldId: departmentNameId,
  fields: [{ id: departmentNameId, name: 'Name', dbFieldName: 'name', type: 'singleLineText' }],
  views: [{ id: `viw${'c'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

describe('Postgres relation aggregates and buckets on PGlite', () => {
  let database: PGliteTestDb;
  let root: Table;
  let target: Table;
  let department: Table;
  let executor: PostgresDataQueryExecutor;

  beforeEach(async () => {
    database = await createPGliteDb();
    root = mapper.toDomain(rootDto())._unsafeUnwrap();
    target = mapper.toDomain(targetDto())._unsafeUnwrap();
    department = mapper.toDomain(departmentDto())._unsafeUnwrap();
    executor = new PostgresDataQueryExecutor(database.db);
    await sql`create table ${sql.id('public', rootPhysical)} (
      __id text primary key,
      title text,
      due timestamptz,
      budget numeric,
      fk_owner text,
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz,
      __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    await sql`create table ${sql.id('public', targetPhysical)} (
      __id text primary key,
      name text,
      amount numeric,
      due timestamptz,
      fk_items text,
      fk_department text,
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz,
      __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    await sql`create table ${sql.id('public', departmentPhysical)} (
      __id text primary key,
      name text
    )`.execute(database.db);
    await sql`create table ${sql.id('public', junctionTags)} (
      __fk_tags text not null,
      __fk_tag_target text not null,
      __order integer
    )`.execute(database.db);
    await sql`insert into ${sql.id('public', rootPhysical)} (__id, title, due, budget, fk_owner) values
      ('recR1', 'Root One', '2026-01-31T16:00:00Z', 250, 'recT1'),
      ('recR2', 'Root Two', '2026-02-10T00:00:00Z', 50, 'recT2'),
      ('recR3', 'Root Three', null, null, null)`.execute(database.db);
    await sql`insert into ${sql.id('public', targetPhysical)} (__id, name, amount, due, fk_items, fk_department) values
      ('recT1', 'Alpha', 10, '2026-01-15T00:00:00Z', 'recR1', 'recD1'),
      ('recT2', 'Beta', 20, '2026-02-15T00:00:00Z', 'recR1', 'recD1'),
      ('recT3', 'Gamma', 5, null, 'recR2', 'recD2'),
      ('recT4', 'Unlinked', 100, null, null, null)`.execute(database.db);
    await sql`insert into ${sql.id('public', departmentPhysical)} (__id, name) values
      ('recD1', 'Engineering'),
      ('recD2', 'Sales')`.execute(database.db);
    await sql`insert into ${sql.id('public', junctionTags)} (__fk_tags, __fk_tag_target, __order) values
      ('recR1', 'recT1', 1),
      ('recR1', 'recT3', 2),
      ('recR1', 'recT3', 3),
      ('recR2', 'recT2', 1)`.execute(database.db);
  });

  afterEach(async () => {
    await database.db.destroy();
  });

  const planFor = (
    definition: DataQueryDefinition,
    rootScope: RecordQueryPluginScope = {},
    sourceScopes: ReadonlyMap<string, RecordQueryPluginScope> = new Map()
  ): DataQueryRelationPlan => {
    const targets = new Map([
      ['owner', target],
      ['items', target],
      ['tags', target],
      ['department', department],
    ]);
    const binding = DataQueryRelationBinding.prepare(definition, root, targets)._unsafeUnwrap();
    return {
      definition,
      query: definition.bind({})._unsafeUnwrap(),
      rootTable: root,
      rootScope,
      rootDependencies: binding.rootDependencies,
      sources: binding.sources.map((source) => ({
        alias: source.alias,
        table: targets.get(source.alias)!,
        linkFieldId: source.linkFieldId,
        scope: sourceScopes.get(source.alias) ?? {},
        dependencies: source.dependencies,
      })),
    };
  };

  it('pre-aggregates one-many sources per root, keeping count zero and sum null', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { items: { linkFieldId: itemsId, tableId: targetTableId } },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { fieldId: titleId, alias: 'title' },
        { source: 'items', statisticFunc: 'count', alias: 'itemCount' },
        { source: 'items', fieldId: amountId, statisticFunc: 'sum', alias: 'itemTotal' },
        { source: 'items', fieldId: amountId, statisticFunc: 'average', alias: 'itemAvg' },
        { source: 'items', fieldId: amountId, statisticFunc: 'max', alias: 'itemMax' },
        { source: 'items', fieldId: targetNameId, statisticFunc: 'unique', alias: 'names' },
      ],
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      {
        id: 'recR1',
        title: 'Root One',
        itemCount: 2,
        itemTotal: 30,
        itemAvg: 15,
        itemMax: 20,
        names: 2,
      },
      {
        id: 'recR2',
        title: 'Root Two',
        itemCount: 1,
        itemTotal: 5,
        itemAvg: 5,
        itemMax: 5,
        names: 1,
      },
      {
        id: 'recR3',
        title: 'Root Three',
        itemCount: 0,
        itemTotal: null,
        itemAvg: null,
        itemMax: null,
        names: 0,
      },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 3 });
  });

  it('deduplicates many-many junction edges before aggregating', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { tags: { linkFieldId: tagsId, tableId: targetTableId } },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'tags', statisticFunc: 'count', alias: 'tagCount' },
        { source: 'tags', fieldId: amountId, statisticFunc: 'sum', alias: 'tagTotal' },
      ],
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recR1', tagCount: 2, tagTotal: 15 },
      { id: 'recR2', tagCount: 1, tagTotal: 20 },
      { id: 'recR3', tagCount: 0, tagTotal: null },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 3 });
  });

  it('keeps the target filter inside the aggregate source', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        items: {
          linkFieldId: itemsId,
          tableId: targetTableId,
          filter: { fieldId: amountId, operator: 'isGreaterEqual', value: 20 },
        },
      },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'items', statisticFunc: 'count', alias: 'itemCount' },
        { source: 'items', fieldId: amountId, statisticFunc: 'sum', alias: 'itemTotal' },
      ],
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recR1', itemCount: 1, itemTotal: 20 },
      { id: 'recR2', itemCount: 0, itemTotal: null },
      { id: 'recR3', itemCount: 0, itemTotal: null },
    ]);
  });

  it('combines a to-one projection with to-many aggregates and sorts by the aggregate alias', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        owner: { linkFieldId: ownerId, tableId: targetTableId },
        items: { linkFieldId: itemsId, tableId: targetTableId },
      },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
        { source: 'items', statisticFunc: 'count', alias: 'itemCount' },
        { source: 'items', fieldId: amountId, statisticFunc: 'sum', alias: 'itemTotal' },
      ],
      sort: [{ alias: 'itemTotal', order: 'desc', nulls: 'last' }],
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recR1', ownerName: 'Alpha', itemCount: 2, itemTotal: 30 },
      { id: 'recR2', ownerName: 'Beta', itemCount: 1, itemTotal: 5 },
      { id: 'recR3', ownerName: null, itemCount: 0, itemTotal: null },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 3 });
  });

  it('applies target authority and field masks before aggregation', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { items: { linkFieldId: itemsId, tableId: targetTableId } },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'items', statisticFunc: 'count', alias: 'itemCount' },
        { source: 'items', fieldId: amountId, statisticFunc: 'sum', alias: 'itemTotal' },
        { source: 'items', fieldId: amountId, statisticFunc: 'unique', alias: 'distinctAmounts' },
      ],
    })._unsafeUnwrap();
    const scopes = new Map<string, RecordQueryPluginScope>([
      [
        'items',
        {
          recordSpec: buildRecordConditionSpec(target, {
            fieldId: amountId,
            operator: 'isGreaterEqual',
            value: 20,
          })._unsafeUnwrap(),
          fieldMasks: [
            {
              fieldId: amountId,
              visibleWhen: buildRecordConditionSpec(target, {
                fieldId: targetNameId,
                operator: 'is',
                value: '__never__',
              })._unsafeUnwrap(),
            },
          ],
        },
      ],
    ]);

    const result = await executor.executeRelation(context, planFor(definition, {}, scopes));

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recR1', itemCount: 1, itemTotal: null, distinctAmounts: 0 },
      { id: 'recR2', itemCount: 0, itemTotal: null, distinctAmounts: 0 },
      { id: 'recR3', itemCount: 0, itemTotal: null, distinctAmounts: 0 },
    ]);
  });

  it('joins a two-hop to-one chain in declaration order', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        owner: { linkFieldId: ownerId, tableId: targetTableId },
        department: {
          linkFieldId: departmentLinkId,
          tableId: departmentTableId,
          via: 'owner',
        },
      },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
        { source: 'department', fieldId: departmentNameId, alias: 'departmentName' },
      ],
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recR1', ownerName: 'Alpha', departmentName: 'Engineering' },
      { id: 'recR2', ownerName: 'Beta', departmentName: 'Engineering' },
      { id: 'recR3', ownerName: null, departmentName: null },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 3 });
  });

  it('truncates dates in the declared time zone', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        {
          fieldId: rootDueId,
          alias: 'utcMonth',
          bucket: { kind: 'dateTrunc', unit: 'month', timeZone: 'UTC' },
        },
        {
          fieldId: rootDueId,
          alias: 'shanghaiMonth',
          bucket: { kind: 'dateTrunc', unit: 'month', timeZone: 'Asia/Shanghai' },
        },
      ],
    })._unsafeUnwrap();

    const result = await executor.execute(context, root, definition.bind({})._unsafeUnwrap(), {});

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recR1', utcMonth: '2026-01-01', shanghaiMonth: '2026-02-01' },
      { id: 'recR2', utcMonth: '2026-02-01', shanghaiMonth: '2026-02-01' },
      { id: 'recR3', utcMonth: null, shanghaiMonth: null },
    ]);
  });

  it('buckets dates by their distance from an anchor', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        {
          fieldId: rootDueId,
          alias: 'aging',
          bucket: {
            kind: 'dateDifferenceRange',
            unit: 'day',
            timeZone: 'UTC',
            anchor: '2026-02-15',
            edges: [
              { maxExclusive: 0, label: 'future' },
              { maxExclusive: 16, label: 'recent' },
            ],
            fallbackLabel: 'overdue',
          },
        },
      ],
    })._unsafeUnwrap();

    const result = await executor.execute(context, root, definition.bind({})._unsafeUnwrap(), {});

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recR1', aging: 'recent' },
      { id: 'recR2', aging: 'recent' },
      { id: 'recR3', aging: null },
    ]);
  });

  it('buckets numeric projections and grouped counts', async () => {
    const records = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        {
          fieldId: budgetId,
          alias: 'band',
          bucket: {
            kind: 'numericRange',
            edges: [
              { maxExclusive: 100, label: 'small' },
              { maxExclusive: 300, label: 'medium' },
            ],
            fallbackLabel: 'large',
            nullLabel: 'missing',
          },
        },
      ],
    })._unsafeUnwrap();
    const grouped = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      aggregates: [{ fieldId: titleId, statisticFunc: 'count', alias: 'roots' }],
      groupBy: [
        {
          fieldId: rootDueId,
          alias: 'month',
          bucket: { kind: 'dateTrunc', unit: 'month', timeZone: 'UTC' },
        },
      ],
      sort: [{ alias: 'month', order: 'asc', nulls: 'last' }],
    })._unsafeUnwrap();

    const banded = await executor.execute(context, root, records.bind({})._unsafeUnwrap(), {});
    const counted = await executor.execute(context, root, grouped.bind({})._unsafeUnwrap(), {});

    expect(banded._unsafeUnwrap().rows).toEqual([
      { id: 'recR1', band: 'medium' },
      { id: 'recR2', band: 'small' },
      { id: 'recR3', band: 'missing' },
    ]);
    expect(counted._unsafeUnwrap().rows).toEqual([
      { month: '2026-01-01', roots: 1 },
      { month: '2026-02-01', roots: 1 },
      { month: null, roots: 1 },
    ]);
  });

  it('aggregates root sums by a two-hop source group', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      relations: {
        owner: { linkFieldId: ownerId, tableId: targetTableId },
        department: {
          linkFieldId: departmentLinkId,
          tableId: departmentTableId,
          via: 'owner',
        },
      },
      aggregates: [
        { fieldId: budgetId, statisticFunc: 'sum', alias: 'budget' },
        { fieldId: titleId, statisticFunc: 'count', alias: 'rows' },
      ],
      groupBy: [{ source: 'department', fieldId: departmentNameId, alias: 'department' }],
      sort: [{ alias: 'department', order: 'asc', nulls: 'last' }],
      page: { limit: 10, includeTotal: true },
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      { department: 'Engineering', budget: 300, rows: 2 },
      { department: null, budget: null, rows: 1 },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 2 });
  });

  it('keeps per-hop filters and scopes independent in aggregate relations', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      relations: {
        owner: {
          linkFieldId: ownerId,
          tableId: targetTableId,
          filter: { fieldId: targetNameId, operator: 'isNot', value: 'Gamma' },
        },
        department: {
          linkFieldId: departmentLinkId,
          tableId: departmentTableId,
          via: 'owner',
          filter: { fieldId: departmentNameId, operator: 'isNot', value: 'Sales' },
        },
      },
      aggregates: [
        { fieldId: budgetId, statisticFunc: 'sum', alias: 'budget' },
        { fieldId: titleId, statisticFunc: 'count', alias: 'rows' },
      ],
      groupBy: [{ source: 'department', fieldId: departmentNameId, alias: 'department' }],
      sort: [{ alias: 'department', order: 'asc', nulls: 'last' }],
      page: { limit: 10, includeTotal: true },
    })._unsafeUnwrap();

    // Hop 1 hides Alpha, hop 2 hides Engineering: every root stays in the null group,
    // but its root aggregate still counts and sums.
    const bothScopes = new Map([
      [
        'owner',
        {
          recordSpec: buildRecordConditionSpec(target, {
            fieldId: targetNameId,
            operator: 'isNot',
            value: 'Alpha',
          })._unsafeUnwrap(),
        },
      ],
      [
        'department',
        {
          recordSpec: buildRecordConditionSpec(department, {
            fieldId: departmentNameId,
            operator: 'isNot',
            value: 'Engineering',
          })._unsafeUnwrap(),
        },
      ],
    ]);
    const both = await executor.executeRelation(context, planFor(definition, {}, bothScopes));
    expect(both._unsafeUnwrap().rows).toEqual([{ department: null, budget: 300, rows: 3 }]);
    expect(both._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 1 });

    // Only hop 1 is restricted: R2 still reaches Engineering, and R1 remains as a
    // null group carrying its own root aggregate.
    const ownerOnly = new Map([['owner', bothScopes.get('owner')!]]);
    const oneHop = await executor.executeRelation(context, planFor(definition, {}, ownerOnly));
    expect(oneHop._unsafeUnwrap().rows).toEqual([
      { department: 'Engineering', budget: 50, rows: 1 },
      { department: null, budget: 250, rows: 2 },
    ]);
    expect(oneHop._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 2 });

    // A masked hop-2 link edge fails closed through the aggregate path too.
    const masked = new Map([
      [
        'owner',
        {
          fieldMasks: [
            {
              fieldId: departmentLinkId,
              visibleWhen: buildRecordConditionSpec(target, {
                fieldId: targetNameId,
                operator: 'is',
                value: 'Alpha',
              })._unsafeUnwrap(),
            },
          ],
        },
      ],
    ]);
    const maskedResult = await executor.executeRelation(context, planFor(definition, {}, masked));
    expect(maskedResult._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
  });

  it('applies link-edge masks to to-one, to-many and via membership', async () => {
    const rootMask = (fieldId: string) => ({
      fieldMasks: [
        {
          fieldId,
          visibleWhen: buildRecordConditionSpec(root, {
            fieldId: titleId,
            operator: 'is',
            value: 'R1',
          })._unsafeUnwrap(),
        },
      ],
    });
    const records = (relations: Record<string, unknown>, select: unknown[]) =>
      DataQueryDefinition.create({
        version: 2,
        kind: 'records',
        tableId: rootTableId,
        relations,
        page: { limit: 10 },
        select: select as never,
      })._unsafeUnwrap();

    const ownerQuery = records({ owner: { linkFieldId: ownerId, tableId: targetTableId } }, [
      { system: 'id', alias: 'id' },
      { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
    ]);
    const ownerResult = await executor.executeRelation(
      context,
      planFor(ownerQuery, rootMask(ownerId))
    );
    expect(ownerResult._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');

    const itemsQuery = records({ items: { linkFieldId: itemsId, tableId: targetTableId } }, [
      { system: 'id', alias: 'id' },
      { source: 'items', statisticFunc: 'count', alias: 'n' },
    ]);
    const itemsResult = await executor.executeRelation(
      context,
      planFor(itemsQuery, rootMask(itemsId))
    );
    expect(itemsResult._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');

    const tagsQuery = records({ tags: { linkFieldId: tagsId, tableId: targetTableId } }, [
      { system: 'id', alias: 'id' },
      { source: 'tags', statisticFunc: 'count', alias: 'n' },
    ]);
    const tagsResult = await executor.executeRelation(
      context,
      planFor(tagsQuery, rootMask(tagsId))
    );
    expect(tagsResult._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');

    const viaQuery = records(
      {
        owner: { linkFieldId: ownerId, tableId: targetTableId },
        department: {
          linkFieldId: departmentLinkId,
          tableId: departmentTableId,
          via: 'owner',
        },
      },
      [
        { system: 'id', alias: 'id' },
        { source: 'department', fieldId: departmentNameId, alias: 'department' },
      ]
    );
    const viaResult = await executor.executeRelation(context, planFor(viaQuery, rootMask(ownerId)));
    expect(viaResult._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');

    const parentMask = new Map([
      [
        'owner',
        {
          fieldMasks: [
            {
              fieldId: departmentLinkId,
              visibleWhen: buildRecordConditionSpec(target, {
                fieldId: targetNameId,
                operator: 'is',
                value: 'Alpha',
              })._unsafeUnwrap(),
            },
          ],
        },
      ],
    ]);
    const parentResult = await executor.executeRelation(context, planFor(viaQuery, {}, parentMask));
    expect(parentResult._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
  });

  it('keeps root pagination and total with an aggregate-alias sort', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { items: { linkFieldId: itemsId, tableId: targetTableId } },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'items', fieldId: amountId, statisticFunc: 'sum', alias: 'itemTotal' },
      ],
      sort: [{ alias: 'itemTotal', order: 'desc', nulls: 'last' }],
      page: { limit: 1, offset: 1, includeTotal: true },
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([{ id: 'recR2', itemTotal: 5 }]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 1, offset: 1, total: 3 });
  });

  it('honours exclusive bucket edges and null-without-label semantics', async () => {
    await sql`insert into ${sql.id('public', rootPhysical)} (__id, title, due, budget) values
      ('recR4', 'Root Four', '2026-01-30T00:00:00Z', 1)`.execute(database.db);
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        {
          fieldId: rootDueId,
          alias: 'aging',
          bucket: {
            kind: 'dateDifferenceRange',
            unit: 'day',
            timeZone: 'UTC',
            anchor: '2026-02-15',
            edges: [
              { maxExclusive: 0, label: 'future' },
              { maxExclusive: 16, label: 'recent' },
            ],
            fallbackLabel: 'overdue',
          },
        },
      ],
    })._unsafeUnwrap();

    const result = await executor.execute(context, root, definition.bind({})._unsafeUnwrap(), {});

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recR1', aging: 'recent' },
      { id: 'recR2', aging: 'recent' },
      { id: 'recR3', aging: null },
      { id: 'recR4', aging: 'overdue' },
    ]);
  });

  it('truncates DST boundaries in the declared zone regardless of session timezone', async () => {
    await sql`insert into ${sql.id('public', rootPhysical)} (__id, title, due, budget) values
      ('recR5', 'Root Five', '2026-03-08T04:30:00Z', 1)`.execute(database.db);
    await sql`set timezone to 'Pacific/Kiritimati'`.execute(database.db);
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        {
          fieldId: rootDueId,
          alias: 'newYorkDay',
          bucket: { kind: 'dateTrunc', unit: 'day', timeZone: 'America/New_York' },
        },
        {
          fieldId: rootDueId,
          alias: 'utcDay',
          bucket: { kind: 'dateTrunc', unit: 'day', timeZone: 'UTC' },
        },
      ],
    })._unsafeUnwrap();

    const result = await executor.execute(context, root, definition.bind({})._unsafeUnwrap(), {});
    await sql`set timezone to 'UTC'`.execute(database.db);
    const row = result._unsafeUnwrap().rows.find((candidate) => candidate.id === 'recR5');
    expect(row).toEqual({
      id: 'recR5',
      newYorkDay: '2026-03-07',
      utcDay: '2026-03-08',
    });
  });

  it('sorts a root group by field id when its alias differs', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: ownerId, tableId: targetTableId } },
      aggregates: [{ fieldId: titleId, statisticFunc: 'count', alias: 'rows' }],
      groupBy: [{ fieldId: titleId, alias: 'rootTitle' }],
      sort: [{ fieldId: titleId, order: 'desc' }],
      page: { limit: 10, includeTotal: true },
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      { rootTitle: 'Root Two', rows: 1 },
      { rootTitle: 'Root Three', rows: 1 },
      { rootTitle: 'Root One', rows: 1 },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 3 });
  });

  it('revalidates a bound relation filter instead of trusting representative values', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      parameters: { due: { type: 'date' } },
      relations: {
        owner: {
          linkFieldId: ownerId,
          tableId: targetTableId,
          filter: {
            fieldId: targetDueId,
            operator: 'isNot',
            value: { type: 'parameter', name: 'due' },
          },
        },
      },
      select: [{ system: 'id', alias: 'id' }],
      page: { limit: 10 },
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root,
      new Map([['owner', target]])
    )._unsafeUnwrap();
    const query = definition
      .bind({
        due: {
          mode: 'dateRange',
          exactDate: '2026-01-01T00:00:00.000Z',
          exactDateEnd: '2026-02-01T00:00:00.000Z',
          timeZone: 'UTC',
        },
      })
      ._unsafeUnwrap();

    const result = await executor.executeRelation(context, {
      definition,
      query,
      rootTable: root,
      rootScope: {},
      rootDependencies: binding.rootDependencies,
      sources: binding.sources.map((source) => ({
        alias: source.alias,
        table: target,
        linkFieldId: source.linkFieldId,
        scope: {},
        dependencies: source.dependencies,
      })),
    });

    expect(result._unsafeUnwrapErr().code).toBe('data_query.filter_operator');
  });
});
