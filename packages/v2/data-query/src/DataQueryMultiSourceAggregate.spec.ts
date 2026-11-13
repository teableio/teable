import { DefaultTableMapper, type ITablePersistenceDTO } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { DataQueryBinding, DataQueryRelationBinding } from './DataQueryBinding';
import { DataQueryDefinition } from './DataQueryDefinition';

const vendorTableId = `tbl${'a'.repeat(16)}`;
const contractTableId = `tbl${'b'.repeat(16)}`;
const invoiceTableId = `tbl${'c'.repeat(16)}`;
const baseId = `bse${'a'.repeat(16)}`;

const vendorNameId = `fld${'a'.repeat(16)}`;
const contractsLinkId = `fld${'b'.repeat(16)}`;
const invoicesLinkId = `fld${'c'.repeat(16)}`;
const contractValueId = `fld${'d'.repeat(16)}`;
const invoicedId = `fld${'e'.repeat(16)}`;
const invoiceStatusId = `fld${'f'.repeat(16)}`;
const contractInvoiceLinkId = `fld${'g'.repeat(16)}`;
const contractExtraId = `fld${'h'.repeat(16)}`;

const vendorPhysical = 'public.p19_vendor';
const contractPhysical = 'public.p19_contract';
const invoicePhysical = 'public.p19_invoice';

const mapper = new DefaultTableMapper();

const vendorDto = (): ITablePersistenceDTO => ({
  id: vendorTableId,
  baseId,
  name: 'Vendors',
  dbTableName: vendorPhysical,
  primaryFieldId: vendorNameId,
  fields: [
    { id: vendorNameId, name: 'Vendor', dbFieldName: 'name', type: 'singleLineText' },
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
        fkHostTableName: contractPhysical,
        selfKeyName: 'fk_vendor',
        foreignKeyName: '__id',
      },
    },
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const contractDto = (): ITablePersistenceDTO => ({
  id: contractTableId,
  baseId,
  name: 'Contracts',
  dbTableName: contractPhysical,
  primaryFieldId: contractValueId,
  fields: [
    { id: contractValueId, name: 'Value', dbFieldName: 'value', type: 'number' },
    { id: contractExtraId, name: 'Extra', dbFieldName: 'extra', type: 'number' },
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
        fkHostTableName: invoicePhysical,
        selfKeyName: 'fk_contract',
        foreignKeyName: '__id',
      },
    },
    {
      id: contractInvoiceLinkId,
      name: 'Primary invoice',
      dbFieldName: 'primary_invoice',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: invoiceTableId,
        lookupFieldId: invoicedId,
        isOneWay: true,
        fkHostTableName: contractPhysical,
        selfKeyName: '__id',
        foreignKeyName: 'fk_primary_invoice',
      },
    },
  ],
  views: [{ id: `viw${'b'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const invoiceDto = (): ITablePersistenceDTO => ({
  id: invoiceTableId,
  baseId,
  name: 'Invoices',
  dbTableName: invoicePhysical,
  primaryFieldId: invoicedId,
  fields: [
    { id: invoicedId, name: 'Invoiced', dbFieldName: 'invoiced', type: 'number' },
    { id: invoiceStatusId, name: 'Status', dbFieldName: 'status', type: 'singleLineText' },
  ],
  views: [{ id: `viw${'c'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const vendor = () => mapper.toDomain(vendorDto())._unsafeUnwrap();
const contract = () => mapper.toDomain(contractDto())._unsafeUnwrap();
const invoice = () => mapper.toDomain(invoiceDto())._unsafeUnwrap();

const targets = () =>
  new Map([
    ['contracts', contract()],
    ['invoices', invoice()],
  ]);

describe('Multi-source aggregate relations', () => {
  it('binds two to-many paths for one grouped report', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        invoices: {
          linkFieldId: invoicesLinkId,
          tableId: invoiceTableId,
          via: 'contracts',
        },
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
      groupBy: [{ fieldId: vendorNameId, alias: 'vendor' }],
    })._unsafeUnwrap();

    const binding = DataQueryRelationBinding.prepare(
      definition,
      vendor(),
      targets()
    )._unsafeUnwrap();

    expect(binding.sources.map((source) => [source.alias, source.parentAlias])).toEqual([
      ['contracts', 'root'],
      ['invoices', 'contracts'],
    ]);
    expect(binding.sources.map((source) => source.cardinality)).toEqual(['many', 'many']);
    expect(binding.outputs).toEqual([
      {
        alias: 'vendor',
        wireType: 'string',
        cellValueType: 'string',
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'contractValue',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'invoiced',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'invoiceCount',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: false,
      },
      {
        alias: 'averageInvoice',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: true,
      },
    ]);
    // Both hops keep their link-edge dependency on the table that hosts the link.
    expect(binding.rootDependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: contractsLinkId, usages: ['relation'] }),
        expect.objectContaining({ fieldId: vendorNameId, usages: ['group'] }),
      ])
    );
    expect(binding.sources[0]!.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: invoicesLinkId, usages: ['relation'] }),
        expect.objectContaining({ fieldId: contractValueId, usages: ['aggregate'] }),
      ])
    );
    expect(binding.sources[1]!.dependencies).toEqual([
      expect.objectContaining({ fieldId: invoicedId, usages: ['aggregate'] }),
    ]);
  });

  it('rejects unique relation metrics in a grouped report', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
      },
      aggregates: [
        { source: 'contracts', fieldId: contractValueId, statisticFunc: 'unique', alias: 'n' },
      ],
    });
    expect(definition._unsafeUnwrapErr().code).toBe('data_query.relation_aggregate_group_unique');
  });

  it('rejects a to-one hop under a to-many parent', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'aggregate',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        primaryInvoice: {
          linkFieldId: contractInvoiceLinkId,
          tableId: invoiceTableId,
          via: 'contracts',
        },
      },
      aggregates: [{ fieldId: vendorNameId, statisticFunc: 'count', alias: 'rows' }],
    })._unsafeUnwrap();

    const manyTargets = new Map([...targets(), ['primaryInvoice', invoice()] as const]);
    expect(
      DataQueryRelationBinding.prepare(definition, vendor(), manyTargets)._unsafeUnwrapErr().code
    ).toBe('data_query.join_via');
  });

  it('caps independent relation metrics', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
      },
      select: [
        { system: 'id', alias: 'id' },
        ...Array.from({ length: 9 }, (_, index) => ({
          source: 'contracts',
          fieldId: contractValueId,
          statisticFunc: 'sum' as const,
          alias: `metric${index}`,
        })),
      ],
    });
    expect(definition._unsafeUnwrapErr().code).toBe('data_query.relation_aggregate_count');
  });

  it('accepts a multi-hop to-many branch on a records query', () => {
    const definition = DataQueryDefinition.create({
      version: 2,
      kind: 'records',
      tableId: vendorTableId,
      relations: {
        contracts: { linkFieldId: contractsLinkId, tableId: contractTableId },
        invoices: {
          linkFieldId: invoicesLinkId,
          tableId: invoiceTableId,
          via: 'contracts',
          filter: { fieldId: invoiceStatusId, operator: 'is', value: 'open' },
        },
      },
      select: [
        { system: 'id', alias: 'id' },
        { source: 'contracts', fieldId: contractValueId, statisticFunc: 'sum', alias: 'value' },
        { source: 'invoices', fieldId: invoicedId, statisticFunc: 'sum', alias: 'invoiced' },
      ],
    })._unsafeUnwrap();

    const binding = DataQueryRelationBinding.prepare(
      definition,
      vendor(),
      targets()
    )._unsafeUnwrap();
    expect(binding.sources[1]!.parentAlias).toBe('contracts');
    expect(binding.outputs.map((output) => output.alias)).toEqual(['id', 'value', 'invoiced']);
    // The declared hop filter is a dependency of its own target table.
    expect(binding.sources[1]!.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: invoiceStatusId, usages: ['filter'] }),
      ])
    );
  });
});

describe('v4 aggregate formula binding', () => {
  const expression = (fieldId: string) => ({
    type: 'formula',
    formula: '{amount} * 2',
    references: { amount: { type: 'field', fieldId } },
  });
  const input = () => ({
    version: 4,
    kind: 'aggregate',
    tableId: vendorTableId,
    relations: { contracts: { linkFieldId: contractsLinkId, tableId: contractTableId } },
    parameters: { minimum: { type: 'number' } },
    aggregates: [
      {
        source: 'contracts',
        expr: expression(contractValueId),
        statisticFunc: 'sum',
        alias: 'total',
        filter: {
          type: 'formula',
          formula: '{amount} > 0',
          references: {
            amount: { type: 'field', fieldId: contractValueId },
            unused: { type: 'field', fieldId: contractExtraId },
          },
        },
      },
    ],
    groupBy: [{ fieldId: vendorNameId, alias: 'vendor' }],
    having: {
      type: 'formula',
      formula: '{total} > {minimum}',
      references: {
        total: { type: 'output', alias: 'total' },
        minimum: { type: 'parameter', name: 'minimum' },
        unusedGroup: { type: 'output', alias: 'vendor' },
      },
    },
  });

  it('binds metric expressions in their own source and HAVING against typed selected outputs', () => {
    const definition = DataQueryDefinition.create(input())._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      vendor(),
      targets()
    )._unsafeUnwrap();
    expect(binding.plan.aggregates[0]).toMatchObject({
      source: 'contracts',
      alias: 'total',
      column: null,
      expression: {
        kind: 'formula',
        recordSource: 'contracts',
        references: {
          amount: { kind: 'field', source: 'contracts', fieldId: contractValueId },
        },
      },
      filter: { kind: 'formula' },
    });
    expect(binding.plan).toMatchObject({
      definitionVersion: 4,
      having: {
        kind: 'formula',
        references: {
          total: { kind: 'output', alias: 'total' },
          minimum: { kind: 'parameter', name: 'minimum' },
        },
      },
    });
    expect(binding.outputs[1]).toEqual({
      alias: 'total',
      wireType: 'numberOrString',
      cellValueType: 'number',
      isMultipleCellValue: false,
      nullable: true,
    });
    expect(binding.sources[0]!.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: contractValueId }),
        expect.objectContaining({ fieldId: contractExtraId }),
      ])
    );
  });

  it('rejects nonboolean or implicit-row HAVING and incompatible formula statistics', () => {
    for (const formula of ['{total}', 'RECORD_ID() = "anything"']) {
      const definition = DataQueryDefinition.create({
        ...input(),
        having: {
          ...input().having,
          formula,
        },
      })._unsafeUnwrap();
      expect(DataQueryRelationBinding.prepare(definition, vendor(), targets()).isErr()).toBe(true);
    }
    const definition = DataQueryDefinition.create({
      ...input(),
      aggregates: [
        {
          source: 'contracts',
          expr: { type: 'formula', formula: '"text"', references: {} },
          statisticFunc: 'sum',
          alias: 'total',
        },
      ],
    })._unsafeUnwrap();
    expect(DataQueryRelationBinding.prepare(definition, vendor(), targets()).isErr()).toBe(true);
  });

  it('rejects root references inside a relation metric formula and still authorizes declared filters', () => {
    const definition = DataQueryDefinition.create({
      ...input(),
      aggregates: [
        {
          ...input().aggregates[0],
          expr: {
            type: 'formula',
            formula: '{name}',
            references: {
              name: { type: 'field', source: 'root', fieldId: vendorNameId },
            },
          },
        },
      ],
    })._unsafeUnwrap();
    const preparation = DataQueryRelationBinding.prepareAuthorization(
      definition,
      vendor(),
      targets()
    )._unsafeUnwrap();
    expect(preparation.plan.usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'root', fieldId: vendorNameId }),
        expect.objectContaining({ source: 'contracts', fieldId: contractExtraId }),
      ])
    );
    expect(preparation.bind().isErr()).toBe(true);
  });

  it('infers root formula aggregate wire types without stored-field surrogates', () => {
    const definition = DataQueryDefinition.create({
      version: 4,
      kind: 'aggregate',
      tableId: vendorTableId,
      aggregates: [
        {
          expr: {
            type: 'formula',
            formula: 'LEN({name})',
            references: {
              name: { type: 'field', fieldId: vendorNameId },
            },
          },
          statisticFunc: 'sum',
          alias: 'length',
          filter: {
            fieldId: vendorNameId,
            operator: 'isNotEmpty',
            value: null,
          },
        },
        {
          expr: {
            type: 'formula',
            formula: '{created}',
            references: {
              created: { type: 'system', system: 'createdTime' },
            },
          },
          statisticFunc: 'earliestDate',
          alias: 'first',
        },
        {
          expr: { type: 'formula', formula: '1 > 0', references: {} },
          statisticFunc: 'checked',
          alias: 'yes',
        },
      ],
      having: {
        type: 'formula',
        formula: '{length} > 0',
        references: {
          length: { type: 'output', alias: 'length' },
        },
      },
    })._unsafeUnwrap();
    const binding = DataQueryBinding.prepare(definition, vendor())._unsafeUnwrap();
    expect(binding.outputs).toEqual([
      {
        alias: 'length',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'first',
        wireType: 'string',
        cellValueType: 'dateTime',
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'yes',
        wireType: 'numberOrString',
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: true,
      },
    ]);
    expect(binding.plan.aggregates[0]).toMatchObject({
      source: 'root',
      column: null,
      filter: { kind: 'legacy', source: 'root' },
      expression: { kind: 'formula', recordSource: 'root' },
    });
  });

  it('allows root metric formulas to read to-one inputs but not relation metric sibling sources', () => {
    const definition = DataQueryDefinition.create({
      version: 4,
      kind: 'aggregate',
      tableId: contractTableId,
      relations: { primary: { linkFieldId: contractInvoiceLinkId, tableId: invoiceTableId } },
      aggregates: [
        {
          expr: {
            type: 'formula',
            formula: '{amount} + {invoice}',
            references: {
              amount: { type: 'field', fieldId: contractValueId },
              invoice: { type: 'field', source: 'primary', fieldId: invoicedId },
            },
          },
          statisticFunc: 'sum',
          alias: 'total',
        },
      ],
    })._unsafeUnwrap();
    const binding = DataQueryRelationBinding.prepare(
      definition,
      contract(),
      new Map([['primary', invoice()]])
    )._unsafeUnwrap();
    expect(binding.plan.aggregates[0]!.expression!.references.invoice).toMatchObject({
      source: 'primary',
    });
    expect(binding.sources[0]!.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: invoicedId, usages: ['aggregate', 'reference'] }),
      ])
    );
  });
});
