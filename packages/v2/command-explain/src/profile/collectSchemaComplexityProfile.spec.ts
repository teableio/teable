import {
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
} from '@teable/v2-core';
import type {
  ComputedUpdatePlan,
  FieldDependencyGraphData,
  FieldMeta,
} from '@teable/v2-adapter-table-repository-postgres';
import { describe, expect, it } from 'vitest';

import {
  collectSchemaComplexityProfile,
  prepareSchemaComplexityInput,
} from './collectSchemaComplexityProfile';

const baseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
const amountId = FieldId.create(`fld${'1'.repeat(16)}`)._unsafeUnwrap();
const doubledId = FieldId.create(`fld${'2'.repeat(16)}`)._unsafeUnwrap();
const recordId = RecordId.create(`rec${'b'.repeat(16)}`)._unsafeUnwrap();

const createTable = () => {
  const amount = NumberField.create({
    id: amountId,
    name: FieldName.create('Amount')._unsafeUnwrap(),
  })._unsafeUnwrap();
  amount.setDbFieldName(DbFieldName.rehydrate('amount')._unsafeUnwrap())._unsafeUnwrap();
  amount.setDbFieldType(DbFieldType.rehydrate('double precision')._unsafeUnwrap())._unsafeUnwrap();
  const doubled = FormulaField.create({
    id: doubledId,
    name: FieldName.create('Doubled')._unsafeUnwrap(),
    expression: FormulaExpression.create(`{${amountId.toString()}} * 2`)._unsafeUnwrap(),
    dependencies: [amountId],
  })._unsafeUnwrap();
  return Table.rehydrate({
    id: tableId,
    baseId,
    name: TableName.create('Amounts')._unsafeUnwrap(),
    dbTableName: DbTableName.rehydrate('profile_test.amounts')._unsafeUnwrap(),
    primaryFieldId: amountId,
    fields: [amount, doubled],
    views: [],
  })._unsafeUnwrap();
};

const graph: FieldDependencyGraphData = {
  fieldsById: new Map<string, FieldMeta>([
    [
      amountId.toString(),
      {
        id: amountId,
        tableId,
        type: 'number',
        isComputed: false,
        options: null,
        lookupOptions: null,
        conditionalOptions: null,
      },
    ],
    [
      doubledId.toString(),
      {
        id: doubledId,
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
      fromFieldId: amountId,
      toFieldId: doubledId,
      fromTableId: tableId,
      toTableId: tableId,
      kind: 'same_record',
      semantic: 'formula_ref',
    },
  ],
};

const plan: ComputedUpdatePlan = {
  baseId,
  seedTableId: tableId,
  seedRecordIds: [recordId],
  extraSeedRecords: [],
  beforeImageRecords: [],
  steps: [{ tableId, fieldIds: [doubledId], level: 1 }],
  edges: [
    {
      fromFieldId: amountId,
      toFieldId: doubledId,
      propagationSourceFieldIds: [amountId],
      propagationTargetFieldIds: [doubledId],
      fromTableId: tableId,
      toTableId: tableId,
      propagationMode: 'conditionalFiltered',
      order: 0,
    },
  ],
  estimatedComplexity: 7,
  changeType: 'update',
  changedFieldIds: [amountId],
  sameTableBatches: [],
  seedAllTableIds: [tableId],
  partialStageBudget: { maxSteps: 1, maxFields: 1, maxEdges: 1 },
};

describe('collectSchemaComplexityProfile', () => {
  it('maps real domain fields, graph edges and planner DTO into separate shapes', () => {
    const profile = collectSchemaComplexityProfile({
      tables: [createTable()],
      graph,
      plan,
      focusTableId: tableId.toString(),
      completeness: 'partial',
      operation: {
        kind: 'update',
        tableId: tableId.toString(),
        changedFieldIds: [amountId.toString()],
        beforeImage: 'available',
        dataPresence: 'empty',
      },
    });

    expect(profile.basis).toBe('schema-only');
    expect(profile.formulas).toHaveLength(1);
    expect(profile.formulas[0]).toMatchObject({
      fieldId: doubledId.toString(),
      tableId: tableId.toString(),
      profile: { status: 'ok', contextFree: false, referenceCount: 1 },
    });
    expect(profile.structural).toMatchObject({
      completeness: 'partial',
      effectiveCompleteness: 'partial',
      fieldCount: 2,
      computedFieldCount: 1,
      edgeCount: 1,
      sameRecordEdgeCount: 1,
      maxDependencyDepth: 1,
      depthStatus: 'partial',
    });

    const operation = profile.operation;
    expect(operation?.schemaPotential.potentialSteps).toEqual([
      { tableId: tableId.toString(), level: 1, fieldIds: [doubledId.toString()] },
    ]);
    expect(operation?.plannerShape).toMatchObject({
      source: 'planner',
      potentialStepCount: 1,
      potentialFieldCount: 1,
      potentialLevelCount: 1,
      seedAllTableIds: [tableId.toString()],
      truncated: true,
      beforeImage: 'available',
    });
    expect(operation?.plannerShape?.propagationPaths).toMatchObject([
      {
        fromFieldId: amountId.toString(),
        toFieldId: doubledId.toString(),
        fromTableId: tableId.toString(),
        toTableId: tableId.toString(),
        mode: 'conditionalFiltered',
        certainty: 'structural',
        origin: 'dependency',
        sourceFieldIds: [amountId.toString()],
        targetFieldIds: [doubledId.toString()],
        sourceFieldCount: 1,
        targetFieldCount: 1,
      },
    ]);
    expect(operation?.propagationModeCounts).toEqual({
      sameRecord: 0,
      linkTraversal: 0,
      conditionalFiltered: 1,
      allTargetRecords: 0,
      backfill: 0,
    });
    expect(profile.evidence).toMatchObject({
      completeness: 'partial',
      dataPresence: 'empty',
      beforeImage: 'available',
    });
    expect(Object.prototype.hasOwnProperty.call(profile, 'score')).toBe(false);
    expect(profile.dataEstimate).toBeUndefined();
  });

  it('keeps one planner path with provenance and counts', () => {
    const profile = collectSchemaComplexityProfile({
      tables: [createTable()],
      graph,
      plan: {
        ...plan,
        edges: [
          {
            ...plan.edges[0]!,
            propagationSourceFieldIds: [amountId, doubledId],
            propagationTargetFieldIds: [doubledId],
            propagationMode: 'allTargetRecords',
            allTargetRecordsReasons: ['conditional_missing_filter'],
          },
        ],
      },
      operation: {
        kind: 'update',
        tableId: tableId.toString(),
        changedFieldIds: [amountId.toString()],
      },
    });

    expect(profile.operation?.plannerShape?.propagationPaths).toHaveLength(1);
    expect(profile.operation?.plannerShape?.propagationPaths[0]).toMatchObject({
      fromFieldId: amountId.toString(),
      toFieldId: doubledId.toString(),
      mode: 'allTargetRecords',
      sourceFieldIds: [amountId.toString(), doubledId.toString()],
      targetFieldIds: [doubledId.toString()],
      sourceFieldCount: 2,
      targetFieldCount: 1,
    });
    expect(
      profile.operation!.plannerShape!.propagationPaths[0]!.sourceFieldCount! *
        profile.operation!.plannerShape!.propagationPaths[0]!.targetFieldCount!
    ).toBe(2);
    expect(profile.operation?.plannerShape?.propagationPaths[0]?.reason).toBe(
      'conditional_missing_filter'
    );
  });

  it('returns a structural profile for empty metadata without inventing runtime cost', () => {
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

    expect(profile.structural).toMatchObject({
      completeness: 'complete',
      effectiveCompleteness: 'complete',
      fieldCount: 0,
      graphNodeCount: 0,
      edgeCount: 0,
      maxDependencyDepth: 0,
      depthStatus: 'exact',
    });
    expect(profile).not.toHaveProperty('runtimeCost');
    expect(profile.operation?.schemaPotential.potentialSteps).toEqual([]);
    expect(profile.dataEstimate).toBeUndefined();
  });

  it('attaches dataEstimate only when statistics are provided', () => {
    const profile = collectSchemaComplexityProfile({
      tables: [createTable()],
      graph,
      plan,
      operation: {
        kind: 'update',
        tableId: tableId.toString(),
        changedFieldIds: [amountId.toString()],
      },
      seedRecordCount: 10,
      statistics: {
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
      },
    });

    expect(profile.dataEstimate).toMatchObject({
      status: 'partial',
      seedRecordCount: 10,
    });
  });
  it('reuses a prepared schema model with the same profile result', () => {
    const table = createTable();
    const base = collectSchemaComplexityProfile({
      tables: [table],
      graph,
      completeness: 'complete',
    });
    const prepared = prepareSchemaComplexityInput({ tables: [table], graph });
    const reused = collectSchemaComplexityProfile({
      tables: [table],
      graph,
      completeness: 'complete',
      preparedSchema: prepared,
    });
    expect(JSON.stringify(reused)).toBe(JSON.stringify(base));
  });

});
