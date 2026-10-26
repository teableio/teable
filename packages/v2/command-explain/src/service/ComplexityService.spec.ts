import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from 'neverthrow';
import type { Kysely } from 'kysely';
import {
  BaseId,
  FieldId,
  FieldName,
  FormulaExpression,
  Table,
  TableId,
  TableName,
  type IExecutionContext,
  type ITableRepository,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  FieldDependencyGraph,
  PostgresComplexityStatisticsReader,
  type FieldDependencyGraphData,
} from '@teable/v2-adapter-table-repository-postgres';

import { ComplexityService, clearComplexityStatisticsCache } from './ComplexityService';

const catalogSnapshot = (tableId: string) => ({
  tableId,
  rowCount: 1000,
  avgRowBytes: null,
  lastAnalyzeAt: null,
  fields: [],
  links: [],
  capturedAt: '2026-01-01T00:00:00.000Z',
  source: 'pg_catalog' as const,
  completeness: 'partial' as const,
  confidence: 'medium' as const,
  warnings: [],
  changeRate: null,
});

const createTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
  const primaryFieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
  const formulaFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
  const expression = FormulaExpression.create(`{${primaryFieldId.toString()}} + 1`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Complexity')._unsafeUnwrap());
  builder
    .field()
    .number()
    .withId(primaryFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .formula()
    .withId(formulaFieldId)
    .withName(FieldName.create('Score')._unsafeUnwrap())
    .withExpression(expression)
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  const graph: FieldDependencyGraphData = {
    fieldsById: new Map([
      [
        primaryFieldId.toString(),
        {
          id: primaryFieldId,
          tableId,
          type: 'number',
          isComputed: false,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ],
      [
        formulaFieldId.toString(),
        {
          id: formulaFieldId,
          tableId,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ],
    ]),
    edges: [
      {
        fromFieldId: primaryFieldId,
        toFieldId: formulaFieldId,
        fromTableId: tableId,
        toTableId: tableId,
        kind: 'same_record',
      },
    ],
  };
  return { table, graph, tableId, primaryFieldId };
};

const createHarness = () => {
  const { table, graph, tableId, primaryFieldId } = createTable();
  const tableRepository = {
    findOne: vi.fn(async () => ok(table)),
    find: vi.fn(async () => ok([table])),
  } as unknown as ITableRepository;
  const dependencyGraph = {
    load: vi.fn(async () => ok(graph)),
  } as unknown as FieldDependencyGraph;
  const service = new ComplexityService(
    tableRepository,
    dependencyGraph,
    {} as Kysely<V1TeableDatabase>
  );
  return { service, table, graph, tableId, primaryFieldId, tableRepository, dependencyGraph };
};


const createAuthorizedHarness = () => {
  const baseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
  const seedTableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
  const seedFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
  const dependencyTableId = TableId.create(`tbl${'d'.repeat(16)}`)._unsafeUnwrap();
  const dependencyFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
  const dependencyFormulaId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();

  const seedBuilder = Table.builder()
    .withId(seedTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Seed')._unsafeUnwrap());
  seedBuilder
    .field()
    .number()
    .withId(seedFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .primary()
    .done();
  seedBuilder.view().defaultGrid().done();
  const seedTable = seedBuilder.build()._unsafeUnwrap();

  const dependencyBuilder = Table.builder()
    .withId(dependencyTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Dependency')._unsafeUnwrap());
  dependencyBuilder
    .field()
    .number()
    .withId(dependencyFieldId)
    .withName(FieldName.create('Quantity')._unsafeUnwrap())
    .primary()
    .done();
  dependencyBuilder
    .field()
    .formula()
    .withId(dependencyFormulaId)
    .withName(FieldName.create('Computed')._unsafeUnwrap())
    .withExpression(FormulaExpression.create('1 + 1')._unsafeUnwrap())
    .done();
  dependencyBuilder.view().defaultGrid().done();
  const dependencyTable = dependencyBuilder.build()._unsafeUnwrap();

  const graph: FieldDependencyGraphData = {
    fieldsById: new Map([
      [
        seedFieldId.toString(),
        {
          id: seedFieldId,
          tableId: seedTableId,
          type: 'number',
          isComputed: false,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ],
      [
        dependencyFieldId.toString(),
        {
          id: dependencyFieldId,
          tableId: dependencyTableId,
          type: 'number',
          isComputed: false,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ],
      [
        dependencyFormulaId.toString(),
        {
          id: dependencyFormulaId,
          tableId: dependencyTableId,
          type: 'formula',
          isComputed: true,
          options: null,
          lookupOptions: null,
          conditionalOptions: null,
        },
      ],
    ]),
    edges: [
      {
        fromFieldId: seedFieldId,
        toFieldId: dependencyFormulaId,
        fromTableId: seedTableId,
        toTableId: dependencyTableId,
        kind: 'cross_record',
      },
    ],
  };

  const tableRepository = {
    findOne: vi.fn(async () => ok(seedTable)),
    find: vi.fn(async () => ok([seedTable, dependencyTable])),
  } as unknown as ITableRepository;
  const dependencyGraph = {
    load: vi.fn(async () => ok(graph)),
  } as unknown as FieldDependencyGraph;
  const service = new ComplexityService(
    tableRepository,
    dependencyGraph,
    {} as Kysely<V1TeableDatabase>
  );
  return { service, seedTableId, dependencyTableId, dependencyFormulaId, seedFieldId };
};

const context = {} as IExecutionContext;

beforeEach(() => {
  clearComplexityStatisticsCache();
});

describe('ComplexityService', () => {
  it('assesses a raw schema without a database', async () => {
    const service = new ComplexityService(
      {} as ITableRepository,
      {} as FieldDependencyGraph,
      {} as Kysely<V1TeableDatabase>
    );
    const result = await service.assess(context, {
      schema: {
        fields: [
          {
            id: 'fldA',
            tableId: 'tblA',
            type: 'text',
            isComputed: false,
          },
        ],
        edges: [],
      },
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.profile.structural.fieldCount).toBe(1);
    expect(value.profile.dataEstimate).toBeUndefined();
    expect(value.assessment.level).toBeDefined();
  });

  it('simulates a raw schema with operation and assumptions', async () => {
    const service = new ComplexityService(
      {} as ITableRepository,
      {} as FieldDependencyGraph,
      {} as Kysely<V1TeableDatabase>
    );
    const result = await service.assess(context, {
      schema: {
        fields: [
          { id: 'fldA', tableId: 'tblA', type: 'text', isComputed: false },
          { id: 'fldB', tableId: 'tblA', type: 'formula', isComputed: true },
        ],
        edges: [
          {
            fromFieldId: 'fldA',
            toFieldId: 'fldB',
            fromTableId: 'tblA',
            toTableId: 'tblA',
            kind: 'same_record',
          },
        ],
      },
      operation: { kind: 'update', tableId: 'tblA', changedFieldIds: ['fldA'] },
      assumptions: { seedRecordCount: 2 },
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.profile.dataEstimate?.status).toBe('partial');
    expect(value.assessment.workload.status).toBe('estimated');
    expect(value.assessment.workload.rows.expected).toBe(2);
  });

  it('assesses table structure without an operation', async () => {
    const { service, tableId } = createHarness();
    const result = await service.assess(context, { tableId: tableId.toString() });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.profile.operation).toBeNull();
    expect(value.profile.dataEstimate).toBeUndefined();
    expect(value.assessment.components.structural).toBeGreaterThanOrEqual(0);
  });

  it('loads a table and estimates from caller assumptions', async () => {
    const { service, tableId, primaryFieldId } = createHarness();
    const result = await service.assess(context, {
      tableId: tableId.toString(),
      operation: {
        kind: 'update',
        tableId: tableId.toString(),
        changedFieldIds: [primaryFieldId.toString()],
      },
      assumptions: { seedRecordCount: 2 },
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.profile.structural.focusTableFieldCount).toBe(2);
    expect(value.profile.dataEstimate?.status).toBe('partial');
    expect(value.assessment.workload.rows.expected).toBe(2);
  });

  it('uses catalog stats when requested and defaults a non-paste seed to one', async () => {
    const { service, tableId, primaryFieldId } = createHarness();
    const collectMany = vi
      .spyOn(PostgresComplexityStatisticsReader.prototype, 'collectMany')
      .mockResolvedValue(ok(catalogSnapshot(tableId.toString())));

    try {
      const result = await service.assess(context, {
        tableId: tableId.toString(),
        operation: {
          kind: 'update',
          tableId: tableId.toString(),
          changedFieldIds: [primaryFieldId.toString()],
        },
        includeCatalogStats: true,
      });

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(collectMany).toHaveBeenCalledOnce();
      expect(value.profile.dataEstimate?.status).toBe('partial');
      expect(value.assessment.workload.rows.expected).toBe(1);
      expect(value.profile.warnings).toContain('seed-record-count-defaulted:1');
    } finally {
      collectMany.mockRestore();
    }
  });

  it('merges caller assumptions with catalog stats per key', async () => {
    const { service, tableId, primaryFieldId } = createHarness();
    const collectMany = vi
      .spyOn(PostgresComplexityStatisticsReader.prototype, 'collectMany')
      .mockResolvedValue(ok(catalogSnapshot(tableId.toString())));

    try {
      const result = await service.assess(context, {
        tableId: tableId.toString(),
        operation: {
          kind: 'update',
          tableId: tableId.toString(),
          changedFieldIds: [primaryFieldId.toString()],
        },
        assumptions: { seedRecordCount: 2 },
        includeCatalogStats: true,
      });

      expect(result.isOk()).toBe(true);
      expect(collectMany).toHaveBeenCalledOnce();
      const value = result._unsafeUnwrap();
      expect(value.profile.dataEstimate?.seedRecordCount).toBe(2);
      expect(value.profile.warnings).toContain('assumption-overridden:seedRecordCount');
      expect(value.profile.warnings).not.toContain('seed-record-count-defaulted:1');
    } finally {
      collectMany.mockRestore();
    }
  });

  it('loads formula metadata across the dependency closure and marks it complete', async () => {
    const { service, table, tableId, graph, dependencyGraph, tableRepository } = createHarness();
    const baseId = table.baseId();
    const otherTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const otherFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const otherFormulaId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(otherTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Other')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(otherFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .formula()
      .withId(otherFormulaId)
      .withName(FieldName.create('Computed')._unsafeUnwrap())
      .withExpression(FormulaExpression.create('1 + 1')._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const otherTable = builder.build()._unsafeUnwrap();

    dependencyGraph.load.mockResolvedValue(
      ok({
        fieldsById: new Map([
          ...graph.fieldsById,
          [
            otherFormulaId.toString(),
            {
              id: otherFormulaId,
              tableId: otherTableId,
              type: 'formula',
              isComputed: true,
              options: null,
              lookupOptions: null,
              conditionalOptions: null,
            },
          ],
        ]),
        edges: [],
      })
    );
    tableRepository.find.mockResolvedValue(ok([table, otherTable]));

    const result = await service.assess(context, { tableId: tableId.toString() });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.profile.structural.completeness).toBe('complete');
    expect(
      value.profile.formulas.find((entry) => entry.fieldId === otherFormulaId.toString())
    ).toMatchObject({
      fieldId: otherFormulaId.toString(),
      tableId: otherTableId.toString(),
    });
    expect(value.profile.warnings).not.toContain(
      `computed-field-without-formula:${otherFormulaId.toString()}`
    );
    expect(value.profile.warnings).not.toContain(
      `formula-metadata-unavailable:${otherFormulaId.toString()}`
    );
  });

  it('does not read catalog without an operation', async () => {
    const { service, tableId } = createHarness();
    const collectMany = vi.spyOn(PostgresComplexityStatisticsReader.prototype, 'collectMany');

    try {
      const result = await service.assess(context, {
        tableId: tableId.toString(),
        includeCatalogStats: true,
      });

      expect(result.isOk()).toBe(true);
      expect(collectMany).not.toHaveBeenCalled();
      expect(result._unsafeUnwrap().profile.warnings).toContain(
        'catalog-statistics-skipped:no-operation'
      );
    } finally {
      collectMany.mockRestore();
    }
  });


  it('keeps dependency metadata when seed and dependency tables are authorized', async () => {
    const { service, seedTableId, dependencyTableId, dependencyFormulaId } =
      createAuthorizedHarness();

    const result = await service.assess(context, {
      tableId: seedTableId.toString(),
      authorizedTableIds: [seedTableId.toString(), dependencyTableId.toString()],
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.profile.structural.completeness).toBe('complete');
    expect(value.profile.structural.edgeCount).toBe(1);
    expect(
      value.profile.formulas.some((entry) => entry.fieldId === dependencyFormulaId.toString())
    ).toBe(true);
    expect(value.profile.warnings).not.toContain(
      `table-metadata-unavailable:${dependencyTableId.toString()}`
    );
  });

  it('hides unauthorized dependency metadata and reports the gap', async () => {
    const { service, seedTableId, dependencyTableId, dependencyFormulaId } =
      createAuthorizedHarness();

    const result = await service.assess(context, {
      tableId: seedTableId.toString(),
      authorizedTableIds: [seedTableId.toString()],
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.profile.structural.completeness).toBe('partial');
    expect(value.profile.structural.edgeCount).toBe(0);
    expect(
      value.profile.formulas.some((entry) => entry.fieldId === dependencyFormulaId.toString())
    ).toBe(false);
    expect(value.profile.warnings).toContain('authorized-table-scope-excluded');
    expect(
      value.profile.warnings.some((warning) => warning.includes(dependencyTableId.toString()))
    ).toBe(false);
  });

  it('validates source exclusivity and assumption/operation pairing', async () => {
    const { service, tableId } = createHarness();
    const noSource = await service.assess(context, {});
    const bothSources = await service.assess(context, {
      tableId: tableId.toString(),
      schema: { fields: [], edges: [] },
    });
    const assumptionsOnly = await service.assess(context, {
      tableId: tableId.toString(),
      assumptions: { seedRecordCount: 1 },
    });
    const catalogWithoutTable = await service.assess(context, {
      schema: { fields: [], edges: [] },
      includeCatalogStats: true,
    });

    expect(noSource.isErr()).toBe(true);
    expect(bothSources.isErr()).toBe(true);
    expect(assumptionsOnly.isErr()).toBe(true);
    expect(catalogWithoutTable.isErr()).toBe(true);
  });
  it('filters unauthorized dependency metadata and keeps authorized closure', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const seedId = TableId.generate()._unsafeUnwrap();
    const depId = TableId.generate()._unsafeUnwrap();
    const seedField = FieldId.generate()._unsafeUnwrap();
    const depField = FieldId.generate()._unsafeUnwrap();
    const seedBuilder = Table.builder()
      .withId(seedId)
      .withBaseId(baseId)
      .withName(TableName.create('Seed')._unsafeUnwrap());
    seedBuilder.field().number().withId(seedField).withName(FieldName.create('Amount')._unsafeUnwrap()).done();
    seedBuilder.view().defaultGrid().done();
    const seed = seedBuilder.build()._unsafeUnwrap();
    const depBuilder = Table.builder()
      .withId(depId)
      .withBaseId(baseId)
      .withName(TableName.create('Dependency')._unsafeUnwrap());
    depBuilder.field().formula().withId(depField).withName(FieldName.create('Copy')._unsafeUnwrap())
      .withExpression(FormulaExpression.create('1')._unsafeUnwrap()).done();
    depBuilder.view().defaultGrid().done();
    const dep = depBuilder.build()._unsafeUnwrap();
    const graph = {
      fieldsById: new Map([
        [seedField.toString(), { id: seedField, tableId: seedId, type: 'number', isComputed: false, options: null, lookupOptions: null, conditionalOptions: null }],
        [depField.toString(), { id: depField, tableId: depId, type: 'formula', isComputed: true, options: null, lookupOptions: null, conditionalOptions: null }],
      ]),
      edges: [{ fromFieldId: seedField, toFieldId: depField, fromTableId: seedId, toTableId: depId, kind: 'cross_record' as const }],
    };
    const repository = {
      findOne: vi.fn(async () => ok(seed)),
      find: vi.fn(async () => ok([seed, dep])),
    } as unknown as ITableRepository;
    const dependencyGraph = { load: vi.fn(async () => ok(graph)) } as unknown as FieldDependencyGraph;
    const service = new ComplexityService(repository, dependencyGraph, {} as Kysely<V1TeableDatabase>);
    const input = {
      tableId: seedId.toString(),
      operation: { kind: 'update' as const, tableId: seedId.toString(), changedFieldIds: [seedField.toString()] },
      includeCatalogStats: false,
    };
    const full = await service.assess(context, { ...input, authorizedTableIds: [seedId.toString(), depId.toString()] });
    expect(full.isOk()).toBe(true);
    const fullProfile = full._unsafeUnwrap().profile;
    expect(fullProfile.structural.fieldCount).toBe(2);
    expect(fullProfile.formulas).toHaveLength(1);
    expect(fullProfile.structural.completeness).toBe('complete');
    const denied = await service.assess(context, { ...input, authorizedTableIds: [seedId.toString()] });
    expect(denied.isOk()).toBe(true);
    const deniedProfile = denied._unsafeUnwrap().profile;
    expect(deniedProfile.structural.fieldCount).toBe(1);
    expect(deniedProfile.formulas).toHaveLength(0);
    expect(deniedProfile.warnings).toContain('authorized-table-scope-excluded');
    expect(
      deniedProfile.warnings.some((warning) => warning.includes(depId.toString()))
    ).toBe(false);
    expect(deniedProfile.structural.completeness).toBe('partial');
  });

});
