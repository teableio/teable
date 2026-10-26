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
      __created_time timestamptz default '2026-01-01T00:00:00Z',
      __last_modified_time timestamptz,
      __auto_number bigint,
      __version integer default 1
    )`.execute(database.db);
    await sql`create table ${sql.id('public', invoicePhysical)} (
      __id text primary key,
      invoiced numeric,
      status text,
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
    await sql`insert into ${sql.id('public', invoicePhysical)} (__id, invoiced, status, fk_contract) values
      ('recI1', 10, 'open', 'recC1'),
      ('recI2', 20, 'open', 'recC2'),
      ('recI3', 30, 'open', 'recC1'),
      ('recI4', 5, 'open', 'recC3')`.execute(database.db);
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
      definition,
      query: definition.bind({})._unsafeUnwrap(),
      rootTable: vendor,
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
});
