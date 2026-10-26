import {
  ActorId,
  BaseId,
  DbFieldName,
  DbFieldType,
  DbTableName,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaField,
  NumberField,
  RecordId,
  Table,
  TableId,
  TableName,
  UpdateRecordCommand,
} from '@teable/v2-core';
import {
  ComputedUpdatePlanner,
  defaultComputedUpdateLockConfig,
  type FieldDependencyGraphData,
  PostgresComplexityStatisticsReader,
  type FieldMeta,
} from '@teable/v2-adapter-table-repository-postgres';
import { Kysely, PostgresDialect } from 'kysely';
import { ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpdateRecordAnalyzer } from './UpdateRecordAnalyzer';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';
import { SqlExplainRunner } from '../utils/SqlExplainRunner';
import { collectSchemaComplexityProfile } from '../profile/collectSchemaComplexityProfile';

afterEach(() => vi.restoreAllMocks());

const fieldId = (suffix: string) =>
  FieldId.create(`fld${suffix.padStart(16, '0')}`)._unsafeUnwrap();
const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const titleId = fieldId('1');
const formulaId = fieldId('2');
const context = { actorId: ActorId.create('complexity-profile-test')._unsafeUnwrap() };

const createTable = (withFormula: boolean) => {
  const title = NumberField.create({
    id: titleId,
    name: FieldName.create('Amount')._unsafeUnwrap(),
  })._unsafeUnwrap();
  title.setDbFieldName(DbFieldName.rehydrate('amount')._unsafeUnwrap())._unsafeUnwrap();
  title.setDbFieldType(DbFieldType.rehydrate('double precision')._unsafeUnwrap())._unsafeUnwrap();
  const formula = FormulaField.create({
    id: formulaId,
    name: FieldName.create('Doubled')._unsafeUnwrap(),
    expression: FormulaExpression.create(`{${titleId.toString()}} * 2`)._unsafeUnwrap(),
    dependencies: [titleId],
  })._unsafeUnwrap();
  return Table.rehydrate({
    id: tableId,
    baseId,
    name: TableName.create('Amounts')._unsafeUnwrap(),
    dbTableName: DbTableName.rehydrate('profile_test.amounts')._unsafeUnwrap(),
    primaryFieldId: titleId,
    fields: withFormula ? [title, formula] : [title],
    views: [],
  })._unsafeUnwrap();
};

const createGraph = (withFormula: boolean): FieldDependencyGraphData => {
  const fields: FieldMeta[] = [
    {
      id: titleId,
      tableId,
      type: 'number',
      isComputed: false,
      options: null,
      lookupOptions: null,
      conditionalOptions: null,
    },
    ...(withFormula
      ? [
          {
            id: formulaId,
            tableId,
            type: 'formula',
            isComputed: true,
            options: null,
            lookupOptions: null,
            conditionalOptions: null,
          },
        ]
      : []),
  ];
  return {
    fieldsById: new Map(fields.map((field) => [field.id.toString(), field])),
    edges: withFormula
      ? [
          {
            fromFieldId: titleId,
            toFieldId: formulaId,
            fromTableId: tableId,
            toTableId: tableId,
            kind: 'same_record',
            semantic: 'formula_ref',
          },
        ]
      : [],
  };
};

describe('UpdateRecord explain schema complexity profile', () => {
  it.each([false, true])(
    'runs the real analyzer and planner without reading data (computed=%s)',
    async (withFormula) => {
      const statisticsSpy = vi.spyOn(PostgresComplexityStatisticsReader.prototype, 'collectMany');
      const table = createTable(withFormula);
      const graphData = createGraph(withFormula);
      const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
      const planner = new ComputedUpdatePlanner(graph as never);
      // A real SQL compiler is available, but any attempt to execute a statement fails this test.
      const connect = vi
        .fn()
        .mockRejectedValue(new Error('Schema-only explain must not query rows'));
      const db = new Kysely({
        dialect: new PostgresDialect({ pool: { connect, end: async () => undefined } as never }),
      });
      const analyzer = new UpdateRecordAnalyzer(
        db as never,
        { getById: async () => ok(table) } as never,
        { findOne: async () => ok(table) } as never,
        graph as never,
        planner,
        defaultComputedUpdateLockConfig,
        new SqlExplainRunner(),
        new ComplexityCalculator(),
        {} as never
      );
      const command = UpdateRecordCommand.create({
        tableId: tableId.toString(),
        recordId: RecordId.create(`rec${'a'.repeat(16)}`)
          ._unsafeUnwrap()
          .toString(),
        fields: { [titleId.toString()]: 3 },
      })._unsafeUnwrap();

      const result = (
        await analyzer.analyze(
          context,
          command,
          { includeSql: false, includeLocks: false },
          Date.now()
        )
      )._unsafeUnwrap();
      const profile = result.schemaComplexityProfile;
      expect(profile).toBeDefined();
      expect(profile?.basis).toBe('schema-only');
      expect(profile?.structural.fieldCount).toBe(withFormula ? 2 : 1);
      expect(profile?.structural.edgeCount).toBe(withFormula ? 1 : 0);
      expect(profile?.formulas).toHaveLength(withFormula ? 1 : 0);
      expect(profile?.operation).not.toBeNull();
      expect(profile?.dataEstimate).toBeUndefined();
      expect(statisticsSpy).not.toHaveBeenCalled();
      expect(result.complexity.score).toBeGreaterThanOrEqual(0);
      expect(connect).not.toHaveBeenCalled();
      expect(graph.load).toHaveBeenCalled();
      await db.destroy();
    }
  );

  it('loads opt-in statistics and attaches a data estimate', async () => {
    const table = createTable(true);
    const graphData = createGraph(true);
    const graph = { load: vi.fn().mockResolvedValue(ok(graphData)) };
    const planner = new ComputedUpdatePlanner(graph as never);
    const connect = vi
      .fn()
      .mockRejectedValue(new Error('Statistics are mocked; no SQL should execute'));
    const db = new Kysely({
      dialect: new PostgresDialect({ pool: { connect, end: async () => undefined } as never }),
    });
    const statisticsSpy = vi
      .spyOn(PostgresComplexityStatisticsReader.prototype, 'collectMany')
      .mockResolvedValue(
        ok({
          tableId: tableId.toString(),
          rowCount: 10,
          avgRowBytes: null,
          lastAnalyzeAt: null,
          fields: [],
          links: [],
          capturedAt: '2026-10-24T00:00:00.000Z',
          source: 'caller',
          completeness: 'complete',
          confidence: 'high',
          changeRate: null,
        })
      );
    const analyzer = new UpdateRecordAnalyzer(
      db as never,
      { getById: async () => ok(table) } as never,
      { findOne: async () => ok(table) } as never,
      graph as never,
      planner,
      defaultComputedUpdateLockConfig,
      new SqlExplainRunner(),
      new ComplexityCalculator(),
      {} as never
    );
    const command = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: RecordId.create(`rec${'a'.repeat(16)}`)
        ._unsafeUnwrap()
        .toString(),
      fields: { [titleId.toString()]: 3 },
    })._unsafeUnwrap();

    const result = (
      await analyzer.analyze(
        context,
        command,
        { includeSql: false, includeLocks: false, includeDataEstimate: true },
        Date.now()
      )
    )._unsafeUnwrap();

    expect(statisticsSpy).toHaveBeenCalledTimes(1);
    expect(result.schemaComplexityProfile?.dataEstimate).toMatchObject({
      status: 'partial',
      seedRecordCount: 1,
    });
    await db.destroy();
  });

  it('returns a zero-structure profile for empty metadata, not a zero-cost claim', () => {
    const profile = collectSchemaComplexityProfile({
      tables: [],
      graph: { fieldsById: new Map(), edges: [] },
      completeness: 'complete',
      operation: {
        kind: 'update',
        tableId: tableId.toString(),
        changedFieldIds: [],
        dataPresence: 'empty',
      },
    });
    expect(profile.structural.fieldCount).toBe(0);
    expect(profile.structural.edgeCount).toBe(0);
    expect(profile).not.toHaveProperty('runtimeCost');
  });
});
