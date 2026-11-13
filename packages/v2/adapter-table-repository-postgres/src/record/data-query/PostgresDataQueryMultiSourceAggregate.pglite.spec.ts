import {
  ActorId,
  buildRecordConditionSpec,
  DefaultTableMapper,
  NoopLogger,
  RecordQueryPluginRunner,
  type ITablePersistenceDTO,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import {
  DataQueryDefinition,
  DataQueryRelationBinding,
  DataQueryService,
  type DataQueryRelationPlan,
  type DataQueryPredicateV5,
  type DataQueryDefinitionV5Input,
} from '@teable/v2-data-query';
import { sql } from 'kysely';
import { ok, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

const vendorTableId = `tbl${'a'.repeat(16)}`;
const contractTableId = `tbl${'b'.repeat(16)}`;
const invoiceTableId = `tbl${'c'.repeat(16)}`;
const baseId = `bse${'a'.repeat(16)}`;

const vendorNameId = `fld${'a'.repeat(16)}`;
const tierId = `fld${'b'.repeat(16)}`;
const contractsLinkId = `fld${'c'.repeat(16)}`;
const manyContractsLinkId = `fld${'d'.repeat(16)}`;
const invoicesLinkId = `fld${'e'.repeat(16)}`;
const manyInvoicesLinkId = `fld${'f'.repeat(16)}`;
const contractValueId = `fld${'g'.repeat(16)}`;
const contractStatusId = `fld${'h'.repeat(16)}`;
const invoicedId = `fld${'i'.repeat(16)}`;
const invoiceStatusId = `fld${'j'.repeat(16)}`;
const invoiceCreatedById = `fld${'u'.repeat(16)}`;
const invoiceUserId = `fld${'v'.repeat(16)}`;
const primaryContractLinkId = `fld${'w'.repeat(16)}`;
const inverseContractLinkId = `fld${'x'.repeat(16)}`;

const vendorPhysical = 'pglite_p19_vendor';
const contractPhysical = 'pglite_p19_contract';
const invoicePhysical = 'pglite_p19_invoice';
const vendorContractJunction = 'pglite_p19_vendor_contract';
const contractInvoiceJunction = 'pglite_p19_contract_invoice';

const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
const mapper = new DefaultTableMapper();

const vendorDto = (): ITablePersistenceDTO => ({
  id: vendorTableId,
  baseId,
  name: 'P1.9 vendor',
  dbTableName: `public.${vendorPhysical}`,
  primaryFieldId: vendorNameId,
  fields: [
    { id: vendorNameId, name: 'Vendor', dbFieldName: 'name', type: 'singleLineText' },
    { id: tierId, name: 'Tier', dbFieldName: 'tier', type: 'singleLineText' },
    {
      id: contractsLinkId,
      name: 'Contracts',
      dbFieldName: 'contracts',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: contractTableId,
        lookupFieldId: contractValueId,
        isOneWay: false,
        fkHostTableName: `public.${contractPhysical}`,
        selfKeyName: 'fk_vendor',
        foreignKeyName: '__id',
      },
    },
    {
      id: manyContractsLinkId,
      name: 'Linked contracts',
      dbFieldName: 'linked_contracts',
      type: 'link',
      options: {
        relationship: 'manyMany',
        foreignTableId: contractTableId,
        lookupFieldId: contractValueId,
        isOneWay: false,
        fkHostTableName: `public.${vendorContractJunction}`,
        selfKeyName: '__fk_vendor',
        foreignKeyName: '__fk_contract',
      },
    },
    {
      id: primaryContractLinkId,
      name: 'Primary contract',
      dbFieldName: 'primary_contract',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: contractTableId,
        lookupFieldId: contractValueId,
        isOneWay: true,
        fkHostTableName: `public.${vendorPhysical}`,
        selfKeyName: '__id',
        foreignKeyName: 'fk_primary',
      },
    },
    {
      id: inverseContractLinkId,
      name: 'Inverse contract',
      dbFieldName: 'inverse_contract',
      type: 'link',
      options: {
        relationship: 'oneOne',
        foreignTableId: contractTableId,
        lookupFieldId: contractValueId,
        isOneWay: false,
        fkHostTableName: `public.${contractPhysical}`,
        selfKeyName: 'fk_primary_vendor',
        foreignKeyName: '__id',
      },
    },
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const contractDto = (): ITablePersistenceDTO => ({
  id: contractTableId,
  baseId,
  name: 'P1.9 contract',
  dbTableName: `public.${contractPhysical}`,
  primaryFieldId: contractValueId,
  fields: [
    { id: contractValueId, name: 'Value', dbFieldName: 'value', type: 'number' },
    { id: contractStatusId, name: 'Status', dbFieldName: 'status', type: 'singleLineText' },
    {
      id: invoicesLinkId,
      name: 'Invoices',
      dbFieldName: 'invoices',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: invoiceTableId,
        lookupFieldId: invoicedId,
        isOneWay: false,
        fkHostTableName: `public.${invoicePhysical}`,
        selfKeyName: 'fk_contract',
        foreignKeyName: '__id',
      },
    },
    {
      id: manyInvoicesLinkId,
      name: 'Linked invoices',
      dbFieldName: 'linked_invoices',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: invoiceTableId,
        lookupFieldId: invoicedId,
        isOneWay: true,
        fkHostTableName: `public.${contractInvoiceJunction}`,
        selfKeyName: '__fk_contract',
        foreignKeyName: '__fk_invoice',
      },
    },
  ],
  views: [{ id: `viw${'b'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const invoiceDto = (): ITablePersistenceDTO => ({
  id: invoiceTableId,
  baseId,
  name: 'P1.9 invoice',
  dbTableName: `public.${invoicePhysical}`,
  primaryFieldId: invoicedId,
  fields: [
    { id: invoicedId, name: 'Invoiced', dbFieldName: 'invoiced', type: 'number' },
    { id: invoiceStatusId, name: 'Status', dbFieldName: 'status', type: 'singleLineText' },
    { id: invoiceCreatedById, name: 'Created by', dbFieldName: 'created_by', type: 'createdBy' },
    { id: invoiceUserId, name: 'Assignee', dbFieldName: 'assignee', type: 'user' },
  ],
  views: [{ id: `viw${'c'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

describe('Multi-source and multi-hop aggregates on PGlite', () => {
  let database: PGliteTestDb;
  let vendor: Table;
  let contract: Table;
  let invoice: Table;
  let executor: PostgresDataQueryExecutor;

  beforeEach(async () => {
    database = await createPGliteDb();
    vendor = mapper.toDomain(vendorDto())._unsafeUnwrap();
    contract = mapper.toDomain(contractDto())._unsafeUnwrap();
    invoice = mapper.toDomain(invoiceDto())._unsafeUnwrap();
    executor = new PostgresDataQueryExecutor(database.db);
    await sql`create table ${sql.id('public', vendorPhysical)} (
      __id text primary key,
      name text,
      tier text,
      fk_primary text,
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz,
      __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    await sql`create table ${sql.id('public', contractPhysical)} (
      __id text primary key,
      value numeric,
      status text,
      fk_vendor text,
      fk_primary_vendor text,
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz,
      __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    await sql`create table ${sql.id('public', invoicePhysical)} (
      __id text primary key,
      invoiced numeric,
      status text,
      created_by text,
      assignee jsonb,
      fk_contract text,
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz,
      __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    await sql`create table ${sql.id('public', vendorContractJunction)} (
      __fk_vendor text not null,
      __fk_contract text not null,
      __order integer
    )`.execute(database.db);
    await sql`create table ${sql.id('public', contractInvoiceJunction)} (
      __fk_contract text not null,
      __fk_invoice text not null,
      __order integer
    )`.execute(database.db);
    await sql`insert into ${sql.id('public', vendorPhysical)} (__id, name, tier) values
      ('recV1', 'Acme', 'A'),
      ('recV2', 'Beta', 'A'),
      ('recV3', 'Gamma', 'B')`.execute(database.db);
    await sql`insert into ${sql.id('public', contractPhysical)} (__id, value, status, fk_vendor) values
      ('recC1', 100, 'open', 'recV1'),
      ('recC2', 200, 'closed', 'recV1'),
      ('recC3', 50, 'open', 'recV2')`.execute(database.db);
    await sql`insert into ${sql.id('public', invoicePhysical)} (__id, invoiced, status, created_by, assignee, fk_contract) values
      ('recI1', 10, 'open', 'user-a', to_jsonb('usr3'::text), 'recC1'),
      ('recI2', 20, 'open', 'user-b', to_jsonb('usr4'::text), 'recC2'),
      ('recI3', 30, 'open', 'user-a', to_jsonb('usr3'::text), 'recC1'),
      ('recI4', 5, 'open', 'user-a', to_jsonb('usr3'::text), 'recC3')`.execute(database.db);
    await sql`insert into ${sql.id('public', vendorContractJunction)} (__fk_vendor, __fk_contract, __order) values
      ('recV1', 'recC1', 1),
      ('recV1', 'recC1', 2),
      ('recV1', 'recC2', 3),
      ('recV2', 'recC3', 1)`.execute(database.db);
    // I3 is reachable through both contracts; the duplicate C1 edge must not count twice.
    await sql`insert into ${sql.id('public', contractInvoiceJunction)} (__fk_contract, __fk_invoice, __order) values
      ('recC1', 'recI1', 1),
      ('recC2', 'recI2', 1),
      ('recC1', 'recI3', 1),
      ('recC2', 'recI3', 2),
      ('recC1', 'recI3', 3),
      ('recC3', 'recI4', 1)`.execute(database.db);
    await sql`update ${sql.id('public', vendorPhysical)} set fk_primary = case __id when 'recV1' then 'recC1' when 'recV2' then 'recC3' end`.execute(
      database.db
    );
    await sql`update ${sql.id('public', contractPhysical)} set fk_primary_vendor = case __id when 'recC1' then 'recV1' when 'recC3' then 'recV2' end`.execute(
      database.db
    );
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
      ['contracts', contract],
      ['manyContracts', contract],
      ['invoices', invoice],
      ['manyInvoices', invoice],
    ]);
    const binding = DataQueryRelationBinding.prepare(definition, vendor, targets)._unsafeUnwrap();
    return {
      query: definition.bind({})._unsafeUnwrap(),
      rootTable: vendor,
      rootScope,
      sources: binding.sources.map((source) => ({
        alias: source.alias,
        table: targets.get(source.alias)!,
        linkFieldId: source.linkFieldId,
        scope: sourceScopes.get(source.alias) ?? {},
      })),
      plan: binding.plan,
    };
  };

  const resultValue = <T>(result: Result<T, unknown>): T => {
    if (result.isErr()) throw new Error(`v4 relation query: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  it('v4 isolates formula metric filters across branches and combines filtered averages before HAVING', async () => {
    await sql`insert into ${sql.id('public', invoicePhysical)} (__id, invoiced, status, fk_contract)
      values ('recI5', 15, 'open', 'recC3')`.execute(database.db);
    await sql`insert into ${sql.id('public', contractInvoiceJunction)} (__fk_contract, __fk_invoice, __order)
      values ('recC3', 'recI5', 2)`.execute(database.db);
    const tables = [vendor, contract, invoice];
    const service = new DataQueryService(
      { findOne: async (_context, spec) => ok(tables.find((table) => spec.isSatisfiedBy(table))!) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      executor
    );
    const definition = resultValue(
      DataQueryDefinition.create({
        version: 4,
        kind: 'aggregate',
        tableId: vendorTableId,
        relations: {
          contracts: { linkFieldId: manyContractsLinkId, tableId: contractTableId },
          invoices: { linkFieldId: manyInvoicesLinkId, tableId: invoiceTableId, via: 'contracts' },
        },
        aggregates: [
          {
            source: 'contracts',
            expr: {
              type: 'formula',
              formula: '{value} * 2',
              references: {
                value: { type: 'field', source: 'contracts', fieldId: contractValueId },
              },
            },
            statisticFunc: 'sum',
            alias: 'doubled',
          },
          {
            source: 'invoices',
            expr: {
              type: 'formula',
              formula: '{value} * 2',
              references: {
                value: { type: 'field', source: 'invoices', fieldId: invoicedId },
              },
            },
            statisticFunc: 'average',
            alias: 'average',
            filter: {
              fieldId: invoicedId,
              operator: 'isGreater',
              value: 10,
            },
          },
          {
            source: 'invoices',
            statisticFunc: 'count',
            alias: 'conditionalCount',
            filter: {
              fieldId: invoicedId,
              operator: 'isGreater',
              value: 10,
            },
          },
          { source: 'invoices', statisticFunc: 'count', alias: 'allCount' },
        ],
        groupBy: [{ fieldId: tierId, alias: 'tier' }],
        having: {
          type: 'formula',
          formula: '{count} > 0',
          references: {
            count: { type: 'output', alias: 'conditionalCount' },
          },
        },
        page: { limit: 1, includeTotal: true },
      })
    );
    expect(resultValue(await service.execute(context, definition))).toEqual({
      rows: [{ tier: 'A', doubled: 700, average: 130 / 3, conditionalCount: 3, allCount: 5 }],
      page: { limit: 1, offset: 0, total: 1 },
    });
    const beyond = resultValue(
      DataQueryDefinition.create({
        ...definition.snapshot(),
        page: {
          limit: 1,
          offset: 5,
          includeTotal: true,
        },
      })
    );
    expect(resultValue(await service.execute(context, beyond))).toEqual({
      rows: [],
      page: { limit: 1, offset: 5, total: 1 },
    });
    const noGroups = resultValue(
      DataQueryDefinition.create({
        ...definition.snapshot(),
        groupBy: [],
        having: {
          type: 'formula',
          formula: '{count} > 99',
          references: {
            count: { type: 'output', alias: 'allCount' },
          },
        },
      })
    );
    expect(resultValue(await service.execute(context, noGroups))).toEqual({
      rows: [],
      page: { limit: 1, offset: 0, total: 0 },
    });
    const noInputs = resultValue(
      DataQueryDefinition.create({
        ...noGroups.snapshot(),
        filter: { fieldId: vendorNameId, operator: 'is', value: 'Absent' },
        having: {
          type: 'formula',
          formula: '{count} = 0',
          references: {
            count: { type: 'output', alias: 'allCount' },
          },
        },
      })
    );
    expect(resultValue(await service.execute(context, noInputs))).toEqual({
      rows: [{ doubled: null, average: null, conditionalCount: 0, allCount: 0 }],
      page: { limit: 1, offset: 0, total: 1 },
    });
  });

  it('v4 applies relation masks before metric formulas and metric predicates and denies filter-only dependencies', async () => {
    const tables = [vendor, contract, invoice];
    const visibleWhen = resultValue(
      buildRecordConditionSpec(contract, {
        fieldId: contractStatusId,
        operator: 'is',
        value: 'open',
      })
    );
    let denied = false;
    const service = new DataQueryService(
      { findOne: async (_context, spec) => ok(tables.find((table) => spec.isSatisfiedBy(table))!) },
      new RecordQueryPluginRunner(
        [
          {
            name: 'v4-relation-access',
            supports: () => true,
            scope: ({ table }) =>
              ok(
                table.id().toString() === contractTableId
                  ? denied
                    ? { readableFieldIds: new Set([contractValueId]) }
                    : { fieldMasks: [{ fieldId: contractValueId, visibleWhen }] }
                  : {}
              ),
          },
        ],
        new NoopLogger()
      ),
      executor
    );
    const value = { type: 'field', source: 'contracts', fieldId: contractValueId } as const;
    const definition = resultValue(
      DataQueryDefinition.create({
        version: 4,
        kind: 'aggregate',
        tableId: vendorTableId,
        relations: { contracts: { linkFieldId: contractsLinkId, tableId: contractTableId } },
        aggregates: [
          {
            source: 'contracts',
            expr: {
              type: 'formula',
              formula: 'IF({value}, {value} * 2, 0)',
              references: { value },
            },
            statisticFunc: 'sum',
            alias: 'value',
          },
          {
            source: 'contracts',
            expr: {
              type: 'formula',
              formula: 'IF(RECORD_ID() = "recC1", {value}, 0)',
              references: { value },
            },
            statisticFunc: 'sum',
            alias: 'identityValue',
          },
          {
            source: 'contracts',
            statisticFunc: 'count',
            alias: 'count',
            filter: {
              type: 'formula',
              formula: '{value} > 0',
              references: {
                value,
                unused: { type: 'field', source: 'contracts', fieldId: contractStatusId },
              },
            },
          },
        ],
        page: { limit: 10, includeTotal: true },
      })
    );
    expect(resultValue(await service.execute(context, definition))).toEqual({
      rows: [{ value: 300, identityValue: 100, count: 2 }],
      page: { limit: 10, offset: 0, total: 1 },
    });
    denied = true;
    const rejected = await service.execute(context, definition);
    expect(rejected.isErr()).toBe(true);
    expect(rejected._unsafeUnwrapErr()).toMatchObject({ code: 'data_query.field_forbidden' });
  });

  it('aggregates invoices through a multi-hop to-many path', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        invoices: { linkFieldId: invoicesLinkId, tableId: invoiceTableId, via: 'contracts' },
      },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'contracts', fieldId: contractValueId, statisticFunc: 'sum', alias: 'value' },
        { source: 'invoices', statisticFunc: 'count', alias: 'invoiceCount' },
        { source: 'invoices', fieldId: invoicedId, statisticFunc: 'sum', alias: 'invoiced' },
      ],
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recV1', value: 300, invoiceCount: 3, invoiced: 60 },
      { id: 'recV2', value: 50, invoiceCount: 1, invoiced: 5 },
      { id: 'recV3', value: null, invoiceCount: 0, invoiced: null },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 3 });
  });

  it('deduplicates a target reachable through several intermediate records', async () => {
    // I3 is linked to contract C1 and C2 of the same vendor, through a junction
    // that also repeats the C1 -> I3 edge.
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        manyInvoices: {
          linkFieldId: manyInvoicesLinkId,
          tableId: invoiceTableId,
          via: 'contracts',
        },
      },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'manyInvoices', statisticFunc: 'count', alias: 'n' },
        { source: 'manyInvoices', fieldId: invoicedId, statisticFunc: 'sum', alias: 'total' },
        { source: 'manyInvoices', fieldId: invoicedId, statisticFunc: 'unique', alias: 'amounts' },
      ],
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recV1', n: 3, total: 60, amounts: 3 },
      { id: 'recV2', n: 1, total: 5, amounts: 1 },
      { id: 'recV3', n: 0, total: null, amounts: 0 },
    ]);
  });

  it('aggregates relation createdBy identities across TEXT and JSON snapshots with masks', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        manyInvoices: {
          linkFieldId: manyInvoicesLinkId,
          tableId: invoiceTableId,
          via: 'contracts',
        },
      },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        {
          source: 'manyInvoices',
          fieldId: invoiceCreatedById,
          statisticFunc: 'unique',
          alias: 'unique',
        },
      ],
    })._unsafeUnwrap();
    const visibleWhen = buildRecordConditionSpec(invoice, {
      fieldId: invoicedId,
      operator: 'is',
      value: 10,
    })._unsafeUnwrap();
    const maskedScope = new Map([
      ['manyInvoices', { fieldMasks: [{ fieldId: invoiceCreatedById, visibleWhen }] }],
    ]);
    const expected = [
      { id: 'recV1', unique: 2 },
      { id: 'recV2', unique: 1 },
      { id: 'recV3', unique: 0 },
    ];
    const maskedExpected = [
      { id: 'recV1', unique: 1 },
      { id: 'recV2', unique: 0 },
      { id: 'recV3', unique: 0 },
    ];
    expect(resultValue(await executor.executeRelation(context, planFor(definition)))).toMatchObject(
      {
        rows: expected,
      }
    );
    expect(
      resultValue(await executor.executeRelation(context, planFor(definition, {}, maskedScope)))
    ).toMatchObject({ rows: maskedExpected });

    await sql`alter table ${sql.id('public', invoicePhysical)} alter column created_by type jsonb using
      case when created_by is null then null else to_jsonb(created_by) end`.execute(database.db);
    expect(resultValue(await executor.executeRelation(context, planFor(definition)))).toMatchObject(
      {
        rows: expected,
      }
    );
    expect(
      resultValue(await executor.executeRelation(context, planFor(definition, {}, maskedScope)))
    ).toMatchObject({ rows: maskedExpected });

    await sql`update ${sql.id('public', invoicePhysical)}
      set created_by = jsonb_build_object('id', created_by #>> '{}', 'name', 'Original')
      where created_by is not null`.execute(database.db);
    expect(resultValue(await executor.executeRelation(context, planFor(definition)))).toMatchObject(
      {
        rows: expected,
      }
    );
    expect(
      resultValue(await executor.executeRelation(context, planFor(definition, {}, maskedScope)))
    ).toMatchObject({ rows: maskedExpected });
  });

  it('aggregates ordinary relation user identities across JSON scalar and object storage', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        manyInvoices: {
          linkFieldId: manyInvoicesLinkId,
          tableId: invoiceTableId,
          via: 'contracts',
        },
      },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        {
          source: 'manyInvoices',
          fieldId: invoiceUserId,
          statisticFunc: 'unique',
          alias: 'unique',
        },
      ],
    })._unsafeUnwrap();
    const visibleWhen = buildRecordConditionSpec(invoice, {
      fieldId: invoicedId,
      operator: 'is',
      value: 10,
    })._unsafeUnwrap();
    const maskedScope = new Map([
      ['manyInvoices', { fieldMasks: [{ fieldId: invoiceUserId, visibleWhen }] }],
    ]);
    const expected = [
      { id: 'recV1', unique: 2 },
      { id: 'recV2', unique: 1 },
      { id: 'recV3', unique: 0 },
    ];
    const maskedExpected = [
      { id: 'recV1', unique: 1 },
      { id: 'recV2', unique: 0 },
      { id: 'recV3', unique: 0 },
    ];
    expect(resultValue(await executor.executeRelation(context, planFor(definition))).rows).toEqual(
      expected
    );
    expect(
      resultValue(await executor.executeRelation(context, planFor(definition, {}, maskedScope)))
        .rows
    ).toEqual(maskedExpected);

    await sql`update ${sql.id('public', invoicePhysical)}
      set assignee = jsonb_build_object('id', assignee #>> '{}', 'name', 'Original')
      where assignee is not null`.execute(database.db);
    expect(resultValue(await executor.executeRelation(context, planFor(definition))).rows).toEqual(
      expected
    );
    expect(
      resultValue(await executor.executeRelation(context, planFor(definition, {}, maskedScope)))
        .rows
    ).toEqual(maskedExpected);
  });

  it('deduplicates duplicate junction edges on a single hop', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: vendorTableId,
      relations: {
        manyContracts: { linkFieldId: manyContractsLinkId, tableId: contractTableId },
      },
      page: { limit: 10 },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'manyContracts', statisticFunc: 'count', alias: 'n' },
        { source: 'manyContracts', fieldId: contractValueId, statisticFunc: 'sum', alias: 'total' },
      ],
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recV1', n: 2, total: 300 },
      { id: 'recV2', n: 1, total: 50 },
      { id: 'recV3', n: 0, total: null },
    ]);
  });

  it('combines two independent to-many branches without multiplying rows', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        manyInvoices: {
          linkFieldId: manyInvoicesLinkId,
          tableId: invoiceTableId,
          via: 'contracts',
        },
      },
      page: { limit: 10, includeTotal: true },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'contracts', statisticFunc: 'count', alias: 'contractCount' },
        { source: 'manyInvoices', statisticFunc: 'count', alias: 'invoiceCount' },
        { source: 'contracts', fieldId: contractValueId, statisticFunc: 'sum', alias: 'value' },
        { source: 'manyInvoices', fieldId: invoicedId, statisticFunc: 'sum', alias: 'invoiced' },
      ],
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      { id: 'recV1', contractCount: 2, invoiceCount: 3, value: 300, invoiced: 60 },
      { id: 'recV2', contractCount: 1, invoiceCount: 1, value: 50, invoiced: 5 },
      { id: 'recV3', contractCount: 0, invoiceCount: 0, value: null, invoiced: null },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 3 });
  });

  it('returns one grouped row per vendor with both metric branches', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        invoices: { linkFieldId: invoicesLinkId, tableId: invoiceTableId, via: 'contracts' },
      },
      aggregates: [
        { fieldId: vendorNameId, statisticFunc: 'count', alias: 'vendors' },
        {
          source: 'contracts',
          fieldId: contractValueId,
          statisticFunc: 'sum',
          alias: 'contractValue',
        },
        { source: 'invoices', fieldId: invoicedId, statisticFunc: 'sum', alias: 'invoiced' },
        { source: 'invoices', statisticFunc: 'count', alias: 'invoiceCount' },
        {
          source: 'invoices',
          fieldId: invoicedId,
          statisticFunc: 'average',
          alias: 'averageInvoice',
        },
      ],
      groupBy: [{ fieldId: vendorNameId, alias: 'vendor' }],
      sort: [{ alias: 'invoiced', order: 'desc', nulls: 'last' }],
      page: { limit: 10, includeTotal: true },
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      {
        vendor: 'Acme',
        vendors: 1,
        contractValue: 300,
        invoiced: 60,
        invoiceCount: 3,
        averageInvoice: 20,
      },
      {
        vendor: 'Beta',
        vendors: 1,
        contractValue: 50,
        invoiced: 5,
        invoiceCount: 1,
        averageInvoice: 5,
      },
      {
        vendor: 'Gamma',
        vendors: 1,
        contractValue: null,
        invoiced: null,
        invoiceCount: 0,
        averageInvoice: null,
      },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 3 });
  });

  it('combines per-root metrics across a shared group with a weighted average', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        invoices: { linkFieldId: invoicesLinkId, tableId: invoiceTableId, via: 'contracts' },
      },
      aggregates: [
        {
          source: 'contracts',
          fieldId: contractValueId,
          statisticFunc: 'sum',
          alias: 'contractValue',
        },
        { source: 'invoices', fieldId: invoicedId, statisticFunc: 'sum', alias: 'invoiced' },
        { source: 'invoices', statisticFunc: 'count', alias: 'invoiceCount' },
        {
          source: 'invoices',
          fieldId: invoicedId,
          statisticFunc: 'average',
          alias: 'averageInvoice',
        },
      ],
      groupBy: [{ fieldId: tierId, alias: 'tier' }],
      page: { limit: 10, includeTotal: true },
    })._unsafeUnwrap();

    const result = await executor.executeRelation(context, planFor(definition));

    expect(result._unsafeUnwrap().rows).toEqual([
      {
        tier: 'A',
        contractValue: 350,
        invoiced: 65,
        invoiceCount: 4,
        averageInvoice: 65 / 4,
      },
      {
        tier: 'B',
        contractValue: null,
        invoiced: null,
        invoiceCount: 0,
        averageInvoice: null,
      },
    ]);
    expect(result._unsafeUnwrap().page).toEqual({ limit: 10, offset: 0, total: 2 });
  });

  it('applies per-hop filters, row scopes and field masks before aggregating', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: vendorTableId,
      relations: {
        contracts: {
          linkFieldId: contractsLinkId,
          tableId: contractTableId,
          filter: { fieldId: contractStatusId, operator: 'is', value: 'open' },
        },
        manyInvoices: {
          linkFieldId: manyInvoicesLinkId,
          tableId: invoiceTableId,
          via: 'contracts',
        },
      },
      aggregates: [
        { source: 'contracts', fieldId: contractValueId, statisticFunc: 'sum', alias: 'value' },
        { source: 'manyInvoices', statisticFunc: 'count', alias: 'invoiceCount' },
        { source: 'manyInvoices', fieldId: invoicedId, statisticFunc: 'sum', alias: 'invoiced' },
      ],
      groupBy: [{ fieldId: vendorNameId, alias: 'vendor' }],
      page: { limit: 10 },
    })._unsafeUnwrap();
    const invoiceScope: RecordQueryPluginScope = {
      fieldMasks: [
        {
          fieldId: invoicedId,
          visibleWhen: buildRecordConditionSpec(invoice, {
            fieldId: invoiceStatusId,
            operator: 'is',
            value: 'void',
          })._unsafeUnwrap(),
        },
      ],
    };

    const filtered = await executor.executeRelation(
      context,
      planFor(definition, {}, new Map([['manyInvoices', invoiceScope]]))
    );

    // Only open contracts contribute; the masked invoice value stays null while
    // membership still counts visible records.
    expect(filtered._unsafeUnwrap().rows).toEqual([
      { vendor: 'Acme', value: 100, invoiceCount: 2, invoiced: null },
      { vendor: 'Beta', value: 50, invoiceCount: 1, invoiced: null },
      { vendor: 'Gamma', value: null, invoiceCount: 0, invoiced: null },
    ]);
  });

  it('fails closed when a link edge is masked', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
      },
      aggregates: [
        { source: 'contracts', fieldId: contractValueId, statisticFunc: 'sum', alias: 'value' },
      ],
      groupBy: [{ fieldId: vendorNameId, alias: 'vendor' }],
      page: { limit: 10 },
    })._unsafeUnwrap();
    const rootScope: RecordQueryPluginScope = {
      fieldMasks: [
        {
          fieldId: contractsLinkId,
          visibleWhen: buildRecordConditionSpec(vendor, {
            fieldId: vendorNameId,
            operator: 'is',
            value: '__never__',
          })._unsafeUnwrap(),
        },
      ],
    };

    const result = await executor.executeRelation(context, planFor(definition, rootScope));

    expect(result._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
  });

  it('paginates grouped metric rows by alias with a stable total', async () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        invoices: { linkFieldId: invoicesLinkId, tableId: invoiceTableId, via: 'contracts' },
      },
      aggregates: [
        { source: 'invoices', fieldId: invoicedId, statisticFunc: 'sum', alias: 'invoiced' },
      ],
      groupBy: [{ fieldId: vendorNameId, alias: 'vendor' }],
      sort: [{ alias: 'invoiced', order: 'desc', nulls: 'last' }],
      page: { limit: 1, offset: 0, includeTotal: true },
    })._unsafeUnwrap();

    const first = await executor.executeRelation(context, planFor(definition));

    expect(first._unsafeUnwrap().rows).toEqual([{ vendor: 'Acme', invoiced: 60 }]);
    expect(first._unsafeUnwrap().page).toEqual({ limit: 1, offset: 0, total: 3 });
  });

  const existenceInput = (
    filter: DataQueryPredicateV5 = { relation: 'contracts', quantifier: 'any' },
    linkFieldId = contractsLinkId
  ): DataQueryDefinitionV5Input => ({
    version: 5,
    kind: 'records',
    tableId: vendorTableId,
    relations: {
      contracts: {
        linkFieldId,
        tableId: contractTableId,
        filter: { fieldId: contractValueId, operator: 'isGreater', value: 80 },
      },
    },
    filter,
    select: [{ fieldId: vendorNameId, alias: 'name' }],
    sort: [{ fieldId: vendorNameId, order: 'asc' }],
    page: { limit: 10, includeTotal: true },
  });

  it.each([contractsLinkId, manyContractsLinkId, primaryContractLinkId, inverseContractLinkId])(
    'V5 selects authorized membership once and counts independently for storage %s',
    async (linkFieldId) => {
      const any = DataQueryDefinition.create(
        existenceInput(undefined, linkFieldId)
      )._unsafeUnwrap();
      const selected = resultValue(await executor.executeRelation(context, planFor(any)));
      expect(selected).toEqual({
        rows: [{ name: 'Acme' }],
        page: { limit: 10, offset: 0, total: 1 },
      });
      const none = DataQueryDefinition.create(
        existenceInput({ relation: 'contracts', quantifier: 'none' }, linkFieldId)
      )._unsafeUnwrap();
      expect(resultValue(await executor.executeRelation(context, planFor(none)))).toEqual({
        rows: [{ name: 'Beta' }, { name: 'Gamma' }],
        page: { limit: 10, offset: 0, total: 2 },
      });
    }
  );

  it('V5 preserves root AND/OR/NOT before paging with the identical unpaginated total', async () => {
    const value = existenceInput({
      conjunction: 'or',
      items: [
        { not: { relation: 'contracts', quantifier: 'none' } },
        { fieldId: tierId, operator: 'is', value: 'B' },
      ],
    });
    value.page = { limit: 1, offset: 1, includeTotal: true };
    const definition = DataQueryDefinition.create(value)._unsafeUnwrap();
    expect(resultValue(await executor.executeRelation(context, planFor(definition)))).toEqual({
      rows: [{ name: 'Gamma' }],
      page: { limit: 1, offset: 1, total: 2 },
    });
    value.filter = {
      conjunction: 'and',
      items: [value.filter!, { fieldId: tierId, operator: 'is', value: 'A' }],
    };
    value.page.offset = 0;
    expect(
      resultValue(
        await executor.executeRelation(
          context,
          planFor(DataQueryDefinition.create(value)._unsafeUnwrap())
        )
      )
    ).toEqual({
      rows: [{ name: 'Acme' }],
      page: { limit: 1, offset: 0, total: 1 },
    });
  });

  it('V5 keeps existence active when every optional relation condition prunes', async () => {
    const value = existenceInput();
    value.parameters = { minimum: { type: 'number' } };
    value.relations!.contracts.filter = {
      not: {
        fieldId: contractValueId,
        operator: 'isLess',
        value: { type: 'parameter', name: 'minimum' },
        optional: true,
      },
    };
    const definition = DataQueryDefinition.create(value)._unsafeUnwrap();
    for (const [parameters, names] of [
      [{}, ['Acme', 'Beta']],
      [{ minimum: 80 }, ['Acme']],
      [{ minimum: 0 }, ['Acme', 'Beta']],
    ] as const) {
      const plan = { ...planFor(definition), query: definition.bind(parameters)._unsafeUnwrap() };
      const result = resultValue(await executor.executeRelation(context, plan));
      expect(result.rows).toEqual(names.map((name) => ({ name })));
      expect(result.page?.total).toBe(names.length);
    }
  });

  it('V5 does not select roots from relation.filter alone', async () => {
    const value = existenceInput();
    delete value.filter;
    expect(
      resultValue(
        await executor.executeRelation(
          context,
          planFor(DataQueryDefinition.create(value)._unsafeUnwrap())
        )
      ).rows
    ).toEqual([{ name: 'Acme' }, { name: 'Beta' }, { name: 'Gamma' }]);
  });

  it.each([contractsLinkId, manyContractsLinkId, primaryContractLinkId])(
    'V5 correlates the entire multi-hop path including to-one ancestors %s',
    async (linkFieldId) => {
      const value = existenceInput({ relation: 'invoices', quantifier: 'any' }, linkFieldId);
      value.relations!.invoices = {
        via: 'contracts',
        linkFieldId: manyInvoicesLinkId,
        tableId: invoiceTableId,
        filter: { fieldId: invoicedId, operator: 'isGreater', value: 25 },
      };
      const definition = DataQueryDefinition.create(value)._unsafeUnwrap();
      expect(resultValue(await executor.executeRelation(context, planFor(definition)))).toEqual({
        rows: [{ name: 'Acme' }],
        page: { limit: 10, offset: 0, total: 1 },
      });
      const hidden = buildRecordConditionSpec(contract, {
        fieldId: contractValueId,
        operator: 'isGreater',
        value: 500,
      })._unsafeUnwrap();
      expect(
        resultValue(
          await executor.executeRelation(
            context,
            planFor(definition, {}, new Map([['contracts', { recordSpec: hidden }]]))
          )
        )
      ).toEqual({ rows: [], page: { limit: 10, offset: 0, total: 0 } });
      value.filter = { relation: 'invoices', quantifier: 'none' };
      expect(
        resultValue(
          await executor.executeRelation(
            context,
            planFor(
              DataQueryDefinition.create(value)._unsafeUnwrap(),
              {},
              new Map([['contracts', { recordSpec: hidden }]])
            )
          )
        )
      ).toEqual({
        rows: [{ name: 'Acme' }, { name: 'Beta' }, { name: 'Gamma' }],
        page: { limit: 10, offset: 0, total: 3 },
      });
    }
  );

  it('V5 applies leaf visibility and root permissions without negating either scope', async () => {
    const value = existenceInput({ relation: 'invoices', quantifier: 'none' });
    value.relations!.invoices = {
      via: 'contracts',
      linkFieldId: invoicesLinkId,
      tableId: invoiceTableId,
      filter: { fieldId: invoicedId, operator: 'isGreater', value: 25 },
    };
    const rootScope = {
      recordSpec: buildRecordConditionSpec(vendor, {
        fieldId: tierId,
        operator: 'is',
        value: 'A',
      })._unsafeUnwrap(),
    };
    const invoiceScope = {
      recordSpec: buildRecordConditionSpec(invoice, {
        fieldId: invoicedId,
        operator: 'isLess',
        value: 25,
      })._unsafeUnwrap(),
    };
    const definition = DataQueryDefinition.create(value)._unsafeUnwrap();
    expect(
      resultValue(
        await executor.executeRelation(
          context,
          planFor(definition, rootScope, new Map([['invoices', invoiceScope]]))
        )
      )
    ).toEqual({
      rows: [{ name: 'Acme' }, { name: 'Beta' }],
      page: { limit: 10, offset: 0, total: 2 },
    });
  });

  it('V5 retains metric-local formula filters and post-HAVING aggregate totals', async () => {
    const tables = [vendor, contract, invoice];
    const service = new DataQueryService(
      { findOne: async (_context, spec) => ok(tables.find((table) => spec.isSatisfiedBy(table))!) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      executor
    );
    const definition = DataQueryDefinition.create({
      version: 5,
      kind: 'aggregate',
      tableId: vendorTableId,
      relations: { contracts: { linkFieldId: manyContractsLinkId, tableId: contractTableId } },
      filter: { relation: 'contracts', quantifier: 'any' },
      aggregates: [
        {
          source: 'contracts',
          expr: {
            type: 'formula',
            formula: '{value} * {factor}',
            references: {
              value: { type: 'field', fieldId: contractValueId },
              factor: { type: 'parameter', name: 'factor' },
            },
          },
          statisticFunc: 'sum',
          alias: 'total',
          filter: { fieldId: contractValueId, operator: 'isGreater', value: 80 },
        },
      ],
      groupBy: [{ fieldId: tierId, alias: 'tier' }],
      having: {
        type: 'formula',
        formula: '{total} > {minimum}',
        references: {
          total: { type: 'output', alias: 'total' },
          minimum: { type: 'parameter', name: 'minimum' },
        },
      },
      parameters: { factor: { type: 'number' }, minimum: { type: 'number' } },
      sort: [{ alias: 'total', order: 'desc' }],
      page: { limit: 1, includeTotal: true },
    })._unsafeUnwrap();
    expect(
      resultValue(
        await service.execute(context, definition, { parameters: { factor: 2, minimum: 500 } })
      )
    ).toEqual({
      rows: [{ tier: 'A', total: 600 }],
      page: { limit: 1, offset: 0, total: 1 },
    });
    expect(
      resultValue(
        await service.execute(context, definition, { parameters: { factor: 2, minimum: 700 } })
      )
    ).toEqual({
      rows: [],
      page: { limit: 1, offset: 0, total: 0 },
    });
  });

  it('V5 rejects unreadable Links and predicate fields rather than returning an empty result', async () => {
    const definition = DataQueryDefinition.create(existenceInput())._unsafeUnwrap();
    const missingLink = await executor.executeRelation(
      context,
      planFor(definition, { readableFieldIds: new Set([vendorNameId]) })
    );
    expect(missingLink._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.field_forbidden',
      details: { fieldId: contractsLinkId },
    });
    const missingPredicate = await executor.executeRelation(
      context,
      planFor(definition, {}, new Map([['contracts', { readableFieldIds: new Set<string>() }]]))
    );
    expect(missingPredicate._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.field_forbidden',
      details: { fieldId: contractValueId },
    });
    const hiddenLink = {
      fieldMasks: [
        {
          fieldId: contractsLinkId,
          visibleWhen: buildRecordConditionSpec(vendor, {
            fieldId: tierId,
            operator: 'is',
            value: 'A',
          })._unsafeUnwrap(),
        },
      ],
    };
    expect(
      (await executor.executeRelation(context, planFor(definition, hiddenLink)))._unsafeUnwrapErr()
        .code
    ).toBe('data_query.field_forbidden');
  });

  it('V5 evaluates descendant formulas only after every ancestor scope and filter admits the path', async () => {
    await sql`update ${sql.id('public', invoicePhysical)} set invoiced = 2000000`.execute(
      database.db
    );
    const value = existenceInput({ relation: 'invoices', quantifier: 'any' });
    value.relations!.invoices = {
      via: 'contracts',
      linkFieldId: invoicesLinkId,
      tableId: invoiceTableId,
      filter: {
        type: 'formula',
        formula: 'LEN(REPT("a", {amount})) > 0',
        references: {
          amount: { type: 'field', fieldId: invoicedId },
        },
      },
    };
    value.relations!.contracts.filter = {
      fieldId: contractValueId,
      operator: 'isGreater',
      value: 500,
    };
    const definition = DataQueryDefinition.create(value)._unsafeUnwrap();
    expect(resultValue(await executor.executeRelation(context, planFor(definition)))).toEqual({
      rows: [],
      page: { limit: 10, offset: 0, total: 0 },
    });
    delete value.relations!.contracts.filter;
    const hidden = buildRecordConditionSpec(contract, {
      fieldId: contractValueId,
      operator: 'isGreater',
      value: 500,
    })._unsafeUnwrap();
    expect(
      resultValue(
        await executor.executeRelation(
          context,
          planFor(
            DataQueryDefinition.create(value)._unsafeUnwrap(),
            {},
            new Map([['contracts', { recordSpec: hidden }]])
          )
        )
      )
    ).toEqual({ rows: [], page: { limit: 10, offset: 0, total: 0 } });
  });
});
