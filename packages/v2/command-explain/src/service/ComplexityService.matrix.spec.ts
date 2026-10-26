import { describe, expect, it, vi } from 'vitest';
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
  type FieldDependencyGraphData,
} from '@teable/v2-adapter-table-repository-postgres';

import {
  ComplexityService,
  orderMatrixRowsBySeverity,
  type ComplexityMatrixRow,
} from './ComplexityService';

const context = {} as IExecutionContext;

const createHarness = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
  const primaryFieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
  const formulaFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
  const expression = FormulaExpression.create(`{${primaryFieldId.toString()}} + 1`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Matrix')._unsafeUnwrap());
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
  return { service, tableId };
};

describe('ComplexityService matrix', () => {
  it('evaluates field rows and table record rows separately, with schema-only basis', async () => {
    const { service, tableId } = createHarness();
    const result = await service.assessMatrix(context, {
      tableId: tableId.toString(),
      includeCatalogStats: false,
      assumptions: {
        rowCounts: { [tableId.toString()]: 100 },
        seedRecordCount: 1,
      },
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();

    expect(value.rows.some((row) => row.scope === 'field')).toBe(true);
    expect(value.rows.some((row) => row.scope === 'table')).toBe(true);
    expect(value.unknownRows.length).toBeGreaterThan(0);
    const tableRow = value.unknownRows.find((row) => row.scope === 'table')!;
    expect(tableRow.scope).toBe('table');
    expect(tableRow.fieldId).toBeNull();
    expect(tableRow.level).toBe('unknown');

    const operations = tableRow.cells.map((cell) => cell.operation);
    expect(operations).toEqual(['create-record', 'delete-record']);
    for (const cell of tableRow.cells) {
      expect(cell.basis).toBe('schema-potential-only');
    }
    const deleteCell = tableRow.cells.find((cell) => cell.operation === 'delete-record')!;
    expect(deleteCell.level).toBe('unknown');
    expect(deleteCell.score).toBeNull();

    const fieldRow = value.rows.find((row) => row.scope === 'field')!;
    const updateCell = fieldRow.cells.find((cell) => cell.operation === 'update')!;
    expect(updateCell.operation).toBe('update');
    expect(updateCell.basis).toBe('schema-potential-only');
    expect(value.basis).toBe('schema-potential-only');
  });

  it('keeps all unknown work out of the ordered rows', async () => {
    const { service, tableId } = createHarness();
    const result = await service.assessMatrix(context, {
      tableId: tableId.toString(),
      operations: ['delete-record'],
      includeCatalogStats: false,
      assumptions: { seedRecordCount: 1 },
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.rows).toHaveLength(1);
    expect(value.unknownRows).toHaveLength(1);
  });


  it('orders known rows by severity, then worst rows, then score', () => {
    const row = (
      fieldId: string,
      level: ComplexityMatrixRow['level'],
      worstRows: number,
      score: number
    ): ComplexityMatrixRow => ({
      scope: 'field',
      fieldId,
      fieldType: 'number',
      tableId: 'tblA',
      level,
      typicalRows: worstRows,
      worstRows,
      mainReason: null,
      confidence: 'medium',
      basis: 'schema-potential-only',
      unknownCellCount: 0,
      cells: [
        {
          operation: 'update',
          basis: 'schema-potential-only',
          level,
          score,
          confidence: 'medium',
          workload: {
            status: 'estimated',
            rows: {
              status: 'estimated',
              expected: worstRows,
              lower: worstRows,
              upper: worstRows,
            },
            typicalLevel: level,
            worstCaseLevel: level,
            level,
            basis: 'max-scan-dirty',
            warnings: [],
          },
          structural: 0,
          dataWork: null,
          risk: 0,
          reasonCodes: [],
          warnings: [],
        },
      ],
    });

    const ordered = orderMatrixRowsBySeverity([
      row('fldLow', 'low', 10, 5),
      row('fldCriticalLowScore', 'critical', 100, 10),
      row('fldHigh', 'high', 200, 20),
      row('fldCriticalHighScore', 'critical', 100, 30),
    ]);

    expect(ordered.map((entry) => entry.fieldId)).toEqual([
      'fldCriticalHighScore',
      'fldCriticalLowScore',
      'fldHigh',
      'fldLow',
    ]);
  });

  it('rejects a matrix wider than the field cap', async () => {
    const { service, tableId } = createHarness();
    const result = await service.assessMatrix(context, {
      tableId: tableId.toString(),
      maxFields: 1,
    });

    expect(result.isErr()).toBe(true);
  });
  it('returns all field rows for a 201-field table in bounded chunks', async () => {
    const baseId = BaseId.create(`bse${'z'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'z'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('Wide')._unsafeUnwrap());
    for (let index = 0; index < 201; index += 1) {
      builder
        .field()
        .number()
        .withId(FieldId.generate()._unsafeUnwrap())
        .withName(FieldName.create(`F${index}`)._unsafeUnwrap())
        .done();
    }
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const repository = {
      findOne: vi.fn(async () => ok(table)),
      find: vi.fn(async () => ok([table])),
    } as unknown as ITableRepository;
    const graph = { load: vi.fn(async () => ok({ fieldsById: new Map(), edges: [] })) };
    const service = new ComplexityService(
      repository,
      graph as unknown as FieldDependencyGraph,
      {} as Kysely<V1TeableDatabase>
    );
    const result = await service.assessMatrix(context, {
      tableId: tableId.toString(),
      includeCatalogStats: false,
      assumptions: { rowCounts: { [tableId.toString()]: 10 }, seedRecordCount: 1 },
    });
    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.fieldCount).toBe(201);
    expect(value.rows.filter((row) => row.scope === 'field')).toHaveLength(201);
    expect(value.rows.some((row) => row.scope === 'table')).toBe(true);
    expect(value.warnings).not.toContain('complexity.matrix.too_many_fields');
  });

});
