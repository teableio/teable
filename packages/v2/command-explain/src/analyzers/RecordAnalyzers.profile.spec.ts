import {
  ActorId,
  BaseId,
  CreateRecordCommand,
  DbFieldName,
  DbFieldType,
  DbTableName,
  DeleteRecordsCommand,
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
import {
  ComputedUpdatePlanner,
  defaultComputedUpdateLockConfig,
  type FieldDependencyGraphData,
  type FieldMeta,
} from '@teable/v2-adapter-table-repository-postgres';
import { Kysely, PostgresDialect } from 'kysely';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { CreateRecordAnalyzer } from './CreateRecordAnalyzer';
import { DeleteRecordsAnalyzer } from './DeleteRecordsAnalyzer';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';
import { SqlExplainRunner } from '../utils/SqlExplainRunner';

const baseId = BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap();
const tableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
const amountId = FieldId.create(`fld${'3'.repeat(16)}`)._unsafeUnwrap();
const doubledId = FieldId.create(`fld${'4'.repeat(16)}`)._unsafeUnwrap();
const tripledId = FieldId.create(`fld${'5'.repeat(16)}`)._unsafeUnwrap();
const recordId = RecordId.create(`rec${'c'.repeat(16)}`)._unsafeUnwrap();
const context = { actorId: ActorId.create('record-profile-test')._unsafeUnwrap() };

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
  const tripled = FormulaField.create({
    id: tripledId,
    name: FieldName.create('Tripled')._unsafeUnwrap(),
    expression: FormulaExpression.create(
      `{${doubledId.toString()}} + {${amountId.toString()}}`
    )._unsafeUnwrap(),
    dependencies: [doubledId, amountId],
  })._unsafeUnwrap();
  return Table.rehydrate({
    id: tableId,
    baseId,
    name: TableName.create('Create profile')._unsafeUnwrap(),
    dbTableName: DbTableName.rehydrate('profile_test.create_profile')._unsafeUnwrap(),
    primaryFieldId: amountId,
    fields: [amount, doubled, tripled],
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
    [
      tripledId.toString(),
      {
        id: tripledId,
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
    {
      fromFieldId: doubledId,
      toFieldId: tripledId,
      fromTableId: tableId,
      toTableId: tableId,
      kind: 'same_record',
      semantic: 'formula_ref',
    },
    {
      fromFieldId: amountId,
      toFieldId: tripledId,
      fromTableId: tableId,
      toTableId: tableId,
      kind: 'same_record',
      semantic: 'formula_ref',
    },
  ],
};

const createDb = () => {
  const connect = vi.fn().mockRejectedValue(new Error('Schema-only explain must not query rows'));
  return {
    connect,
    db: new Kysely({
      dialect: new PostgresDialect({
        pool: { connect, end: async () => undefined } as never,
      }),
    }),
  };
};

const createAnalyzerDeps = (table: Table) => {
  const graphLoader = { load: vi.fn().mockResolvedValue(ok(graph)) };
  const planner = new ComputedUpdatePlanner(graphLoader as never);
  return { graphLoader, planner, table };
};

describe('record analyzer schema complexity profiles', () => {
  it('mounts a profile from the real CreateRecord analyzer and keeps legacy complexity', async () => {
    const table = createTable();
    const { db, connect } = createDb();
    const { graphLoader, planner } = createAnalyzerDeps(table);
    const analyzer = new CreateRecordAnalyzer(
      db as never,
      { getById: async () => ok(table) } as never,
      { findOne: async () => ok(table) } as never,
      graphLoader as never,
      planner,
      defaultComputedUpdateLockConfig,
      new SqlExplainRunner(),
      new ComplexityCalculator(),
      {} as never
    );
    const command = CreateRecordCommand.create({
      tableId: tableId.toString(),
      fields: { [amountId.toString()]: 3 },
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
    expect(profile?.structural).toMatchObject({
      fieldCount: 3,
      computedFieldCount: 2,
      edgeCount: 3,
    });
    expect(profile?.operation).toMatchObject({ kind: 'create', effectiveShapeSource: 'planner' });
    expect(profile?.operation?.plannerShape).not.toBeNull();
    expect(profile?.operation?.schemaPotential.potentialSteps).toEqual([
      { tableId: tableId.toString(), level: 1, fieldIds: [doubledId.toString()] },
      { tableId: tableId.toString(), level: 2, fieldIds: [tripledId.toString()] },
    ]);
    expect(profile?.operation?.schemaPotential.potentialStepCount).toBe(2);
    expect(profile?.operation?.schemaPotential.potentialFieldCount).toBe(2);
    expect(result.complexity.score).toBeGreaterThanOrEqual(0);
    expect(connect).not.toHaveBeenCalled();
    await db.destroy();
  });

  it('mounts a profile from the real DeleteRecords analyzer without SQL explain', async () => {
    const table = createTable();
    const { db, connect } = createDb();
    const { graphLoader, planner } = createAnalyzerDeps(table);
    const analyzer = new DeleteRecordsAnalyzer(
      db as never,
      { getById: async () => ok(table) } as never,
      { findOne: async () => ok(table) } as never,
      graphLoader as never,
      planner,
      defaultComputedUpdateLockConfig,
      new SqlExplainRunner(),
      new ComplexityCalculator(),
      {} as never
    );
    const command = DeleteRecordsCommand.create({
      tableId: tableId.toString(),
      recordIds: [recordId.toString()],
    })._unsafeUnwrap();

    const result = (
      await analyzer.analyze(
        context,
        command,
        { includeSql: false, includeLocks: false },
        Date.now()
      )
    )._unsafeUnwrap();

    expect(result.schemaComplexityProfile?.operation).toMatchObject({
      kind: 'delete',
      fieldChange: null,
      pasteMode: null,
    });
    expect(result.schemaComplexityProfile?.operation?.schemaPotential.propagationPaths).toEqual([]);
    expect(result.schemaComplexityProfile?.operation?.riskFlags).toContain(
      'record-delete-schema-potential-unavailable'
    );
    expect(result.complexity.score).toBeGreaterThanOrEqual(0);
    expect(connect).not.toHaveBeenCalled();
    await db.destroy();
  });
});
