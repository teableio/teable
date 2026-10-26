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

const rootTableId = `tbl${'j'.repeat(16)}`;
const targetTableId = `tbl${'k'.repeat(16)}`;
const titleId = `fld${'j'.repeat(16)}`;
const linkId = `fld${'k'.repeat(16)}`;
const targetNameId = `fld${'l'.repeat(16)}`;
const targetSecretId = `fld${'m'.repeat(16)}`;
const reviewerId = `fld${'n'.repeat(16)}`;
const managerId = `fld${'o'.repeat(16)}`;
const partnerId = `fld${'p'.repeat(16)}`;
const inversePartnerId = `fld${'q'.repeat(16)}`;
const dueDateId = `fld${'r'.repeat(16)}`;
const rootPhysical = 'pglite_relation_root';
const targetPhysical = 'pglite_relation_target';
const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
const mapper = new DefaultTableMapper();

const rootDto = (): ITablePersistenceDTO => ({
  id: rootTableId,
  baseId: `bse${'j'.repeat(16)}`,
  name: 'Relation root',
  dbTableName: `public.${rootPhysical}`,
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', dbFieldName: 'title', type: 'singleLineText' },
    {
      id: linkId,
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
      id: reviewerId,
      name: 'Reviewer',
      dbFieldName: 'reviewer',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: targetTableId,
        lookupFieldId: targetNameId,
        isOneWay: true,
        fkHostTableName: `public.${rootPhysical}`,
        selfKeyName: '__id',
        foreignKeyName: 'fk_reviewer',
      },
    },
    {
      id: managerId,
      name: 'Manager',
      dbFieldName: 'manager',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: rootTableId,
        lookupFieldId: titleId,
        isOneWay: true,
        fkHostTableName: `public.${rootPhysical}`,
        selfKeyName: '__id',
        foreignKeyName: 'fk_manager',
      },
    },
    {
      id: partnerId,
      name: 'Partner',
      dbFieldName: 'partner',
      type: 'link',
      options: {
        relationship: 'oneOne',
        foreignTableId: targetTableId,
        lookupFieldId: targetNameId,
        isOneWay: true,
        fkHostTableName: `public.${rootPhysical}`,
        selfKeyName: '__id',
        foreignKeyName: 'fk_partner',
      },
    },
    {
      id: inversePartnerId,
      name: 'Inverse partner',
      dbFieldName: 'inverse_partner',
      type: 'link',
      options: {
        relationship: 'oneOne',
        foreignTableId: targetTableId,
        lookupFieldId: targetNameId,
        isOneWay: true,
        fkHostTableName: `public.${targetPhysical}`,
        selfKeyName: 'fk_inverse',
        foreignKeyName: '__id',
      },
    },
    { id: dueDateId, name: 'Due', dbFieldName: 'due', type: 'date' },
  ],
  views: [{ id: `viw${'j'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const targetDto = (): ITablePersistenceDTO => ({
  id: targetTableId,
  baseId: `bse${'j'.repeat(16)}`,
  name: 'Relation target',
  dbTableName: `public.${targetPhysical}`,
  primaryFieldId: targetNameId,
  fields: [
    {
      id: targetNameId,
      name: 'Name',
      dbFieldName: 'name',
      type: 'singleLineText',
    },
    {
      id: targetSecretId,
      name: 'Secret',
      dbFieldName: 'secret',
      type: 'singleLineText',
    },
  ],
  views: [{ id: `viw${'k'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

describe('Postgres relation data query on PGlite', () => {
  let database: PGliteTestDb;
  let root: Table;
  let target: Table;
  let executor: PostgresDataQueryExecutor;

  beforeEach(async () => {
    database = await createPGliteDb();
    root = mapper.toDomain(rootDto())._unsafeUnwrap();
    target = mapper.toDomain(targetDto())._unsafeUnwrap();
    executor = new PostgresDataQueryExecutor(database.db);
    await sql`create table ${sql.id('public', rootPhysical)} (
      __id text primary key,
      title text,
      fk_owner text,
      fk_reviewer text,
      fk_manager text,
      fk_partner text,
      due date,
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz,
      __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    await sql`create table ${sql.id('public', targetPhysical)} (
      __id text primary key,
      name text,
      secret text,
      fk_inverse text,
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz,
      __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    await sql`insert into ${sql.id('public', rootPhysical)} (__id, title, fk_owner, fk_reviewer, fk_manager, fk_partner, due, __last_modified_time) values
      ('recA', 'Alpha', 'recT1', 'recT2', 'recB', 'recT1', '2024-06-01', '2026-01-15T00:00:00Z'),
      ('recB', 'Beta', 'recT2', 'recT1', null, 'recT2', '2025-06-01', '2026-02-01T00:00:00Z'),
      ('recC', 'Gamma', null, null, null, null, null, null),
      ('recD', 'Delta', 'missing', 'missing', null, 'missing', '2024-02-01', null)`.execute(
      database.db
    );
    await sql`insert into ${sql.id('public', targetPhysical)} (__id, name, secret, fk_inverse) values
      ('recT1', 'One', 's1', 'recA'),
      ('recT2', 'Two', 's2', 'recB')`.execute(database.db);
  });

  afterEach(async () => {
    await database.db.destroy();
  });

  it('left joins a many-one link, keeps unmatched nulls, and counts roots once', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: linkId, tableId: targetTableId } },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { fieldId: titleId, alias: 'title' },
        { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
        { source: 'owner', system: 'id', alias: 'ownerId' },
      ],
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root,
      new Map([['owner', target]])
    )._unsafeUnwrap();
    const query = definition.bind({})._unsafeUnwrap();
    const plan: DataQueryRelationPlan = {
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
    };

    const result = await executor.executeRelation(context, plan);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', title: 'Alpha', ownerName: 'One', ownerId: 'recT1' },
      { id: 'recB', title: 'Beta', ownerName: 'Two', ownerId: 'recT2' },
      { id: 'recC', title: 'Gamma', ownerName: null, ownerId: null },
      { id: 'recD', title: 'Delta', ownerName: null, ownerId: null },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 4 });
  });
  it('applies the target record scope inside the join', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: linkId, tableId: targetTableId } },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
      ],
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root,
      new Map([['owner', target]])
    )._unsafeUnwrap();
    const query = definition.bind({})._unsafeUnwrap();
    const targetScope = {
      recordSpec: buildRecordConditionSpec(target, {
        fieldId: targetNameId,
        operator: 'is',
        value: 'One',
      })._unsafeUnwrap(),
    };
    const plan: DataQueryRelationPlan = {
      definition,
      query,
      rootTable: root,
      rootScope: {},
      rootDependencies: binding.rootDependencies,
      sources: binding.sources.map((source) => ({
        alias: source.alias,
        table: target,
        linkFieldId: source.linkFieldId,
        scope: targetScope,
        dependencies: source.dependencies,
      })),
    };

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', ownerName: 'One' },
      { id: 'recB', ownerName: null },
      { id: 'recC', ownerName: null },
      { id: 'recD', ownerName: null },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 4 });
  });

  const planFor = (
    definition: DataQueryDefinition,
    targetTables: ReadonlyMap<string, Table>,
    rootScope: RecordQueryPluginScope,
    sourceScopes: ReadonlyMap<string, RecordQueryPluginScope>,
    values: Record<string, unknown> = {}
  ): DataQueryRelationPlan => {
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root,
      targetTables
    )._unsafeUnwrap();
    return {
      definition,
      query: definition.bind(values)._unsafeUnwrap(),
      rootTable: root,
      rootScope,
      rootDependencies: binding.rootDependencies,
      sources: binding.sources.map((source) => ({
        alias: source.alias,
        table: targetTables.get(source.alias)!,
        linkFieldId: source.linkFieldId,
        scope: sourceScopes.get(source.alias) ?? {},
        dependencies: source.dependencies,
      })),
    };
  };

  it('joins two links to the same target with independent scopes', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        owner: { linkFieldId: linkId, tableId: targetTableId },
        reviewer: { linkFieldId: reviewerId, tableId: targetTableId },
      },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { fieldId: titleId, alias: 'title' },
        { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
        { source: 'reviewer', fieldId: targetNameId, alias: 'reviewerName' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(
      definition,
      new Map([
        ['owner', target],
        ['reviewer', target],
      ]),
      {},
      new Map([
        [
          'owner',
          {
            recordSpec: buildRecordConditionSpec(target, {
              fieldId: targetNameId,
              operator: 'is',
              value: 'One',
            })._unsafeUnwrap(),
          },
        ],
        ['reviewer', {}],
      ])
    );

    const result = await executor.executeRelation(context, plan);
    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', title: 'Alpha', ownerName: 'One', reviewerName: 'Two' },
      { id: 'recB', title: 'Beta', ownerName: null, reviewerName: 'One' },
      { id: 'recC', title: 'Gamma', ownerName: null, reviewerName: null },
      { id: 'recD', title: 'Delta', ownerName: null, reviewerName: null },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 4 });
  });

  it('joins a self relation without colliding with the root alias', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { manager: { linkFieldId: managerId, tableId: rootTableId } },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { fieldId: titleId, alias: 'title' },
        { source: 'manager', fieldId: titleId, alias: 'managerTitle' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(definition, new Map([['manager', root]]), {}, new Map([['manager', {}]]));

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', title: 'Alpha', managerTitle: 'Beta' },
      { id: 'recB', title: 'Beta', managerTitle: null },
      { id: 'recC', title: 'Gamma', managerTitle: null },
      { id: 'recD', title: 'Delta', managerTitle: null },
    ]);
  });

  it('masks only the target field its condition hides', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: linkId, tableId: targetTableId } },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
        { source: 'owner', fieldId: targetSecretId, alias: 'ownerSecret' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(
      definition,
      new Map([['owner', target]]),
      {},
      new Map([
        [
          'owner',
          {
            fieldMasks: [
              {
                fieldId: targetSecretId,
                visibleWhen: buildRecordConditionSpec(target, {
                  fieldId: targetNameId,
                  operator: 'is',
                  value: 'Two',
                })._unsafeUnwrap(),
              },
            ],
          },
        ],
      ])
    );

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', ownerName: 'One', ownerSecret: null },
      { id: 'recB', ownerName: 'Two', ownerSecret: 's2' },
      { id: 'recC', ownerName: null, ownerSecret: null },
      { id: 'recD', ownerName: null, ownerSecret: null },
    ]);
  });

  it('fails closed when the target field or link edge is unreadable', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: linkId, tableId: targetTableId } },
      page: { limit: 10 },
      select: [
        { fieldId: titleId, alias: 'title' },
        { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
      ],
    })._unsafeUnwrap();
    const targetUnreadable = await executor.executeRelation(
      context,
      planFor(
        definition,
        new Map([['owner', target]]),
        {},
        new Map([['owner', { readableFieldIds: new Set() }]])
      )
    );
    expect(targetUnreadable._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
    const linkUnreadable = await executor.executeRelation(
      context,
      planFor(
        definition,
        new Map([['owner', target]]),
        { readableFieldIds: new Set([titleId]) },
        new Map([['owner', {}]])
      )
    );
    expect(linkUnreadable._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
  });

  it('accepts a relation alias r without an internal alias collision', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { r: { linkFieldId: linkId, tableId: targetTableId } },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { fieldId: titleId, alias: 'title' },
        { source: 'r', fieldId: targetNameId, alias: 'ownerName' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(definition, new Map([['r', target]]), {}, new Map([['r', {}]]));

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', title: 'Alpha', ownerName: 'One' },
      { id: 'recB', title: 'Beta', ownerName: 'Two' },
      { id: 'recC', title: 'Gamma', ownerName: null },
      { id: 'recD', title: 'Delta', ownerName: null },
    ]);
  });

  it('joins a root-hosted one-one link through its own foreign key', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { partner: { linkFieldId: partnerId, tableId: targetTableId } },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'partner', fieldId: targetNameId, alias: 'partnerName' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(
      definition,
      new Map([['partner', target]]),
      {},
      new Map([['partner', {}]])
    );

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', partnerName: 'One' },
      { id: 'recB', partnerName: 'Two' },
      { id: 'recC', partnerName: null },
      { id: 'recD', partnerName: null },
    ]);
  });

  it('joins an inverse one-one through the target foreign key', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { inverse: { linkFieldId: inversePartnerId, tableId: targetTableId } },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'inverse', fieldId: targetNameId, alias: 'inverseName' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(
      definition,
      new Map([['inverse', target]]),
      {},
      new Map([['inverse', {}]])
    );

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', inverseName: 'One' },
      { id: 'recB', inverseName: 'Two' },
      { id: 'recC', inverseName: null },
      { id: 'recD', inverseName: null },
    ]);
  });

  it('sorts by a joined source field and keeps unmatched roots when nulls are last', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { partner: { linkFieldId: partnerId, tableId: targetTableId } },
      sort: [{ source: 'partner', fieldId: targetNameId, order: 'asc', nulls: 'last' }],
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'partner', fieldId: targetNameId, alias: 'partnerName' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(
      definition,
      new Map([['partner', target]]),
      {},
      new Map([['partner', {}]])
    );

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', partnerName: 'One' },
      { id: 'recB', partnerName: 'Two' },
      { id: 'recC', partnerName: null },
      { id: 'recD', partnerName: null },
    ]);
  });

  it('binds a parameterized sort to a joined source field', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { partner: { linkFieldId: partnerId, tableId: targetTableId } },
      parameters: { by: { type: 'string' } },
      sort: [
        {
          field: { type: 'parameter', name: 'by' },
          order: 'desc',
          nulls: 'last',
          allowed: [{ source: 'partner', fieldId: targetNameId }],
        },
      ],
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'partner', fieldId: targetNameId, alias: 'partnerName' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(
      definition,
      new Map([['partner', target]]),
      {},
      new Map([['partner', {}]]),
      { by: targetNameId }
    );

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recB', partnerName: 'Two' },
      { id: 'recA', partnerName: 'One' },
      { id: 'recC', partnerName: null },
      { id: 'recD', partnerName: null },
    ]);
  });

  it('applies a target filter inside the left join and keeps the root total', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        partner: {
          linkFieldId: partnerId,
          tableId: targetTableId,
          filter: { fieldId: targetNameId, operator: 'is', value: 'One' },
        },
      },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'partner', fieldId: targetNameId, alias: 'partnerName' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(
      definition,
      new Map([['partner', target]]),
      {},
      new Map([['partner', {}]])
    );

    const result = (await executor.executeRelation(context, plan))._unsafeUnwrap();

    expect(result.rows).toEqual([
      { id: 'recA', partnerName: 'One' },
      { id: 'recB', partnerName: null },
      { id: 'recC', partnerName: null },
      { id: 'recD', partnerName: null },
    ]);
    expect(result.page).toEqual({ limit: 10, offset: 0, total: 4 });
  });

  it('returns null target system projections when the left join misses', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: linkId, tableId: targetTableId } },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'owner', system: 'id', alias: 'ownerId' },
        { source: 'owner', system: 'version', alias: 'ownerVersion' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(definition, new Map([['owner', target]]), {}, new Map([['owner', {}]]));

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', ownerId: 'recT1', ownerVersion: 1 },
      { id: 'recB', ownerId: 'recT2', ownerVersion: 1 },
      { id: 'recC', ownerId: null, ownerVersion: null },
      { id: 'recD', ownerId: null, ownerVersion: null },
    ]);
  });

  it('never lets skipRecordSpec drop a target row scope', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: linkId, tableId: targetTableId } },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'owner', fieldId: targetNameId, alias: 'ownerName' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(
      definition,
      new Map([['owner', target]]),
      {},
      new Map([
        [
          'owner',
          {
            skipRecordSpec: true,
            recordSpec: buildRecordConditionSpec(target, {
              fieldId: targetNameId,
              operator: 'is',
              value: 'One',
            })._unsafeUnwrap(),
          },
        ],
      ])
    );

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', ownerName: 'One' },
      { id: 'recB', ownerName: null },
      { id: 'recC', ownerName: null },
      { id: 'recD', ownerName: null },
    ]);
  });

  it('validates and applies a parameterized date-range filter', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      parameters: {
        window: {
          type: 'date',
          default: {
            mode: 'dateRange',
            exactDate: '2024-01-01T00:00:00.000Z',
            exactDateEnd: '2024-12-31T23:59:59.999Z',
            timeZone: 'UTC',
          },
        },
      },
      relations: { owner: { linkFieldId: linkId, tableId: targetTableId } },
      filter: {
        fieldId: dueDateId,
        operator: 'isWithIn',
        value: { type: 'parameter', name: 'window' },
      },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { fieldId: dueDateId, alias: 'due' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(definition, new Map([['owner', target]]), {}, new Map([['owner', {}]]));

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', due: '2024-06-01T00:00:00.000Z' },
      { id: 'recD', due: '2024-02-01T00:00:00.000Z' },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 2 });
  });

  it('rejects an isNot date-range filter instead of dropping the predicate', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      parameters: {
        window: {
          type: 'date',
          default: {
            mode: 'exactDate',
            exactDate: '2026-01-01T00:00:00.000Z',
            timeZone: 'UTC',
          },
        },
      },
      relations: { owner: { linkFieldId: linkId, tableId: targetTableId } },
      filter: {
        fieldId: dueDateId,
        operator: 'isNot',
        value: { type: 'parameter', name: 'window' },
      },
      page: { limit: 10 },
      select: [{ system: 'id', alias: 'id' }],
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      root,
      new Map([['owner', target]])
    )._unsafeUnwrap();
    // A caller-supplied date range is only visible after binding; the executor must
    // reject the unsupported negation instead of letting the visitor drop the filter.
    const query = definition
      .bind({
        window: {
          mode: 'dateRange',
          exactDate: '2024-01-01T00:00:00.000Z',
          exactDateEnd: '2024-12-31T23:59:59.999Z',
          timeZone: 'UTC',
        },
      })
      ._unsafeUnwrap();
    const plan: DataQueryRelationPlan = {
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
    };

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrapErr().code).toBe('data_query.filter_operator');
  });

  it('keeps v1 null ordering for a nullable root field with and without relations', async () => {
    const sort = [{ fieldId: dueDateId, order: 'asc' as const }];
    const select = [{ system: 'id' as const, alias: 'id' }];
    const relational = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: linkId, tableId: targetTableId } },
      page: { limit: 10 },
      sort,
      select,
    })._unsafeUnwrap();
    const relatedResult = await executor.executeRelation(
      context,
      planFor(relational, new Map([['owner', target]]), {}, new Map([['owner', {}]]))
    );
    const plain = DataQueryDefinition.create({
      version: 1,
      kind: 'records',
      tableId: rootTableId,
      page: { limit: 10 },
      sort,
      select,
    })._unsafeUnwrap();
    const plainResult = await executor.execute(context, root, plain.bind({})._unsafeUnwrap(), {});

    expect(relatedResult._unsafeUnwrap().rows.map((row) => row.id)).toEqual([
      'recC',
      'recD',
      'recA',
      'recB',
    ]);
    expect(plainResult._unsafeUnwrap().rows.map((row) => row.id)).toEqual([
      'recC',
      'recD',
      'recA',
      'recB',
    ]);
  });

  it('keeps v1 null ordering for a root system column with and without relations', async () => {
    const sort = [{ system: 'lastModifiedTime' as const, order: 'asc' as const }];
    const select = [{ system: 'id' as const, alias: 'id' }];
    const relational = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: { owner: { linkFieldId: linkId, tableId: targetTableId } },
      page: { limit: 10 },
      sort,
      select,
    })._unsafeUnwrap();
    const relatedResult = await executor.executeRelation(
      context,
      planFor(relational, new Map([['owner', target]]), {}, new Map([['owner', {}]]))
    );
    const plain = DataQueryDefinition.create({
      version: 1,
      kind: 'records',
      tableId: rootTableId,
      page: { limit: 10 },
      sort,
      select,
    })._unsafeUnwrap();
    const plainResult = await executor.execute(context, root, plain.bind({})._unsafeUnwrap(), {});

    expect(relatedResult._unsafeUnwrap().rows.map((row) => row.id)).toEqual([
      'recC',
      'recD',
      'recA',
      'recB',
    ]);
    expect(plainResult._unsafeUnwrap().rows.map((row) => row.id)).toEqual([
      'recC',
      'recD',
      'recA',
      'recB',
    ]);
  });

  it('keeps long relation aliases with a shared prefix from colliding in SQL', async () => {
    const sharedPrefix = `relation_${'x'.repeat(70)}`;
    const firstAlias = `${sharedPrefix}_first`;
    const secondAlias = `${sharedPrefix}_second`;
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        [firstAlias]: { linkFieldId: linkId, tableId: targetTableId },
        [secondAlias]: { linkFieldId: reviewerId, tableId: targetTableId },
      },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: firstAlias, fieldId: targetNameId, alias: 'firstLinkName' },
        { source: secondAlias, fieldId: targetNameId, alias: 'secondLinkName' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(
      definition,
      new Map([
        [firstAlias, target],
        [secondAlias, target],
      ]),
      {},
      new Map([
        [
          firstAlias,
          {
            recordSpec: buildRecordConditionSpec(target, {
              fieldId: targetNameId,
              operator: 'is',
              value: 'One',
            })._unsafeUnwrap(),
          },
        ],
      ])
    );

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', firstLinkName: 'One', secondLinkName: 'Two' },
      { id: 'recB', firstLinkName: null, secondLinkName: 'One' },
      { id: 'recC', firstLinkName: null, secondLinkName: null },
      { id: 'recD', firstLinkName: null, secondLinkName: null },
    ]);
  });

  it('keeps dotted, unicode, and NUL relation aliases out of SQL identifiers', async () => {
    const dottedAlias = 'owner.profile';
    const unicodeAlias = '负责人';
    const nulAlias = 'owner\u0000tag';
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        [dottedAlias]: { linkFieldId: linkId, tableId: targetTableId },
        [unicodeAlias]: { linkFieldId: reviewerId, tableId: targetTableId },
        [nulAlias]: { linkFieldId: partnerId, tableId: targetTableId },
      },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: dottedAlias, fieldId: targetNameId, alias: 'dottedName' },
        { source: unicodeAlias, fieldId: targetNameId, alias: 'unicodeName' },
        { source: nulAlias, fieldId: targetNameId, alias: 'nulName' },
      ],
    })._unsafeUnwrap();
    const plan = planFor(
      definition,
      new Map([
        [dottedAlias, target],
        [unicodeAlias, target],
        [nulAlias, target],
      ]),
      {},
      new Map([
        [
          dottedAlias,
          {
            recordSpec: buildRecordConditionSpec(target, {
              fieldId: targetNameId,
              operator: 'is',
              value: 'One',
            })._unsafeUnwrap(),
          },
        ],
        [
          unicodeAlias,
          {
            recordSpec: buildRecordConditionSpec(target, {
              fieldId: targetNameId,
              operator: 'is',
              value: 'Two',
            })._unsafeUnwrap(),
          },
        ],
      ])
    );

    const result = await executor.executeRelation(context, plan);

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recA', dottedName: 'One', unicodeName: 'Two', nulName: 'One' },
      { id: 'recB', dottedName: null, unicodeName: null, nulName: 'Two' },
      { id: 'recC', dottedName: null, unicodeName: null, nulName: null },
      { id: 'recD', dottedName: null, unicodeName: null, nulName: null },
    ]);
  });
});
