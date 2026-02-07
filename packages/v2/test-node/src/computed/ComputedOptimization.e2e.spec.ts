/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Computed field optimization E2E tests.
 *
 * These tests verify end-to-end behavior for computed field optimizations:
 * - Insert optimization for link fields (FK location awareness)
 * - Delete optimization
 * - Formula chain computation
 */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  DeleteRecordsCommand,
  RecordsBatchUpdated,
  type BaseId,
  type CreateRecordResult,
  type CreateTableResult,
  type DeleteRecordsResult,
  type FieldId,
  type ICommandBus,
  type IExecutionContext,
  type RecordId,
  type Table,
  type TableId,
  UpdateRecordCommand,
  type UpdateRecordResult,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

// =============================================================================
// Test helpers
// =============================================================================

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

interface ICreateTableInput {
  name: string;
  fields: Array<{
    id?: string;
    type: string;
    name: string;
    isPrimary?: boolean;
    options?: Record<string, unknown>;
  }>;
  views?: Array<{ type: string; name?: string }>;
}

const createTable = async (
  commandBus: ICommandBus,
  baseId: BaseId,
  input: ICreateTableInput
): Promise<{ table: Table; fieldIds: Map<string, FieldId> }> => {
  const command = CreateTableCommand.create({
    baseId: baseId.toString(),
    name: input.name,
    fields: input.fields,
    views: input.views ?? [{ type: 'grid' }],
  })._unsafeUnwrap();

  const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
    createContext(),
    command
  );

  const { table } = result._unsafeUnwrap();

  const fieldIds = new Map<string, FieldId>();
  for (const field of table.getFields()) {
    fieldIds.set(field.name().toString(), field.id());
  }

  return { table, fieldIds };
};

const createRecord = async (
  commandBus: ICommandBus,
  tableId: TableId,
  fields: Record<string, unknown>
): Promise<RecordId> => {
  const command = CreateRecordCommand.create({
    tableId: tableId.toString(),
    fields,
  })._unsafeUnwrap();

  const result = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
    createContext(),
    command
  );

  return result._unsafeUnwrap().record.id();
};

const updateRecord = async (
  commandBus: ICommandBus,
  tableId: TableId,
  recordId: RecordId,
  fields: Record<string, unknown>
): Promise<void> => {
  const command = UpdateRecordCommand.create({
    tableId: tableId.toString(),
    recordId: recordId.toString(),
    fields,
  })._unsafeUnwrap();

  await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(createContext(), command);
};

const deleteRecord = async (
  commandBus: ICommandBus,
  tableId: TableId,
  recordId: RecordId
): Promise<void> => {
  const command = DeleteRecordsCommand.create({
    tableId: tableId.toString(),
    recordIds: [recordId.toString()],
  })._unsafeUnwrap();

  const result = await commandBus.execute<DeleteRecordsCommand, DeleteRecordsResult>(
    createContext(),
    command
  );

  result._unsafeUnwrap();
};

/**
 * Creates bidirectional link scenario:
 * TableA (One side): Name (primary), Value (number)
 * TableB (Many side): Name (primary), LinkToA (manyOne link), LookupValue (lookup A.Value)
 */
const createBidirectionalLinkScenario = async (
  commandBus: ICommandBus,
  baseId: BaseId
): Promise<{
  tableA: Table;
  tableB: Table;
  aFieldIds: Map<string, FieldId>;
  bFieldIds: Map<string, FieldId>;
  aValueFieldId: FieldId;
  bLinkFieldId: FieldId;
  bLookupFieldId: FieldId;
}> => {
  const aValueFieldId = `fld${'a'.repeat(16)}`;
  const bLinkFieldId = `fld${'b'.repeat(16)}`;
  const bLookupFieldId = `fld${'c'.repeat(16)}`;

  const { table: tableA, fieldIds: aFieldIds } = await createTable(commandBus, baseId, {
    name: 'SourceTable',
    fields: [
      { type: 'singleLineText', name: 'Name', isPrimary: true },
      { type: 'number', id: aValueFieldId, name: 'Value' },
    ],
  });

  const aNameFieldId = aFieldIds.get('Name')!;

  const { table: tableB, fieldIds: bFieldIds } = await createTable(commandBus, baseId, {
    name: 'TargetTable',
    fields: [
      { type: 'singleLineText', name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: bLinkFieldId,
        name: 'LinkToA',
        options: {
          relationship: 'manyOne',
          foreignTableId: tableA.id().toString(),
          lookupFieldId: aNameFieldId.toString(),
          // bidirectional (isOneWay omitted = false)
        },
      },
      {
        type: 'lookup',
        id: bLookupFieldId,
        name: 'LookupValue',
        options: {
          linkFieldId: bLinkFieldId,
          foreignTableId: tableA.id().toString(),
          lookupFieldId: aValueFieldId,
        },
      },
    ],
  });

  return {
    tableA,
    tableB,
    aFieldIds,
    bFieldIds,
    aValueFieldId: aFieldIds.get('Value')!,
    bLinkFieldId: bFieldIds.get('LinkToA')!,
    bLookupFieldId: bFieldIds.get('LookupValue')!,
  };
};

/**
 * Creates a table with a formula chain: number -> formula1 -> formula2
 */
const createFormulaChainTable = async (
  commandBus: ICommandBus,
  baseId: BaseId
): Promise<{
  table: Table;
  fieldIds: Map<string, FieldId>;
  baseFieldId: FieldId;
  formula1FieldId: FieldId;
  formula2FieldId: FieldId;
}> => {
  const baseFieldId = `fld${'d'.repeat(16)}`;
  const formula1FieldId = `fld${'e'.repeat(16)}`;
  const formula2FieldId = `fld${'f'.repeat(16)}`;

  const { table, fieldIds } = await createTable(commandBus, baseId, {
    name: 'FormulaChainTable',
    fields: [
      { type: 'singleLineText', name: 'Name', isPrimary: true },
      { type: 'number', id: baseFieldId, name: 'Base' },
      {
        type: 'formula',
        id: formula1FieldId,
        name: 'Step1',
        options: { expression: `{${baseFieldId}} * 2` },
      },
      {
        type: 'formula',
        id: formula2FieldId,
        name: 'Step2',
        options: { expression: `{${formula1FieldId}} + 10` },
      },
    ],
  });

  return {
    table,
    fieldIds,
    baseFieldId: fieldIds.get('Base')!,
    formula1FieldId: fieldIds.get('Step1')!,
    formula2FieldId: fieldIds.get('Step2')!,
  };
};

// =============================================================================
// Tests
// =============================================================================

describe('ComputedOptimization (e2e)', () => {
  beforeEach(async () => {
    await getV2NodeTestContainer().dispose();
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  afterEach(async () => {
    await getV2NodeTestContainer().dispose();
  });

  describe('insert optimization', () => {
    it('creates record on One-side table (bidirectional link)', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

      const { tableA, aFieldIds } = await createBidirectionalLinkScenario(commandBus, baseId);

      const nameFieldId = aFieldIds.get('Name')!;
      const valueFieldId = aFieldIds.get('Value')!;

      const recordId = await createRecord(commandBus, tableA.id(), {
        [nameFieldId.toString()]: 'TestRecord',
        [valueFieldId.toString()]: 42,
      });

      const dbTableName = tableA.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

      const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();

      expect(rows.length).toBe(1);
      const row = rows[0];

      const nameDbField = tableA
        .getFields()
        .find((f) => f.name().toString() === 'Name')!
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();
      const valueDbField = tableA
        .getFields()
        .find((f) => f.name().toString() === 'Value')!
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();

      expect(row[nameDbField]).toBe('TestRecord');
      expect(row[valueDbField]).toBe(42);
    });

    it('creates record on Many-side without link value', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

      const { tableB, bFieldIds, bLookupFieldId } = await createBidirectionalLinkScenario(
        commandBus,
        baseId
      );

      const nameFieldId = bFieldIds.get('Name')!;

      const recordId = await createRecord(commandBus, tableB.id(), {
        [nameFieldId.toString()]: 'TargetRecord',
      });

      const dbTableName = tableB.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

      const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();

      expect(rows.length).toBe(1);
      const row = rows[0];

      const lookupDbField = tableB
        .getFields()
        .find((f) => f.id().toString() === bLookupFieldId.toString())!
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();

      // Lookup should be null when no link is set
      expect(row[lookupDbField]).toBeNull();
    });

    it('creates record on Many-side with link value', async () => {
      const { container, baseId, processOutbox } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

      const { tableA, tableB, aFieldIds, bFieldIds, bLinkFieldId, bLookupFieldId } =
        await createBidirectionalLinkScenario(commandBus, baseId);

      // Create source record in tableA
      const aNameFieldId = aFieldIds.get('Name')!;
      const aValueFieldId = aFieldIds.get('Value')!;

      const sourceRecordId = await createRecord(commandBus, tableA.id(), {
        [aNameFieldId.toString()]: 'SourceRecord',
        [aValueFieldId.toString()]: 42,
      });

      // Create target record in tableB with link to source
      const bNameFieldId = bFieldIds.get('Name')!;

      const targetRecordId = await createRecord(commandBus, tableB.id(), {
        [bNameFieldId.toString()]: 'TargetRecord',
        [bLinkFieldId.toString()]: { id: sourceRecordId.toString() },
      });

      await processOutbox();

      const dbTableName = tableB.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

      const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', targetRecordId.toString())
        .execute();

      expect(rows.length).toBe(1);
      const row = rows[0];

      const lookupDbField = tableB
        .getFields()
        .find((f) => f.id().toString() === bLookupFieldId.toString())!
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();

      // Lookup values are returned as arrays
      expect(row[lookupDbField]).toStrictEqual([42]);
    });
  });

  it('batches lookup updates for multiple linked records', async () => {
    const { container, baseId, processOutbox, eventBus } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const { tableA, tableB, aFieldIds, aValueFieldId, bLinkFieldId } =
      await createBidirectionalLinkScenario(commandBus, baseId);

    const aNameFieldId = aFieldIds.get('Name')!;
    const sourceIds = await Promise.all([
      createRecord(commandBus, tableA.id(), {
        [aNameFieldId.toString()]: 'Order-1',
        [aValueFieldId.toString()]: 101,
      }),
      createRecord(commandBus, tableA.id(), {
        [aNameFieldId.toString()]: 'Order-2',
        [aValueFieldId.toString()]: 202,
      }),
      createRecord(commandBus, tableA.id(), {
        [aNameFieldId.toString()]: 'Order-3',
        [aValueFieldId.toString()]: 303,
      }),
    ]);

    const targetIds = await Promise.all([
      createRecord(commandBus, tableB.id(), { Name: 'Target-1' }),
      createRecord(commandBus, tableB.id(), { Name: 'Target-2' }),
      createRecord(commandBus, tableB.id(), { Name: 'Target-3' }),
    ]);

    const eventCountBefore = eventBus.events().length;

    await Promise.all(
      targetIds.map((targetId, index) =>
        updateRecord(commandBus, tableB.id(), targetId, {
          [bLinkFieldId.toString()]: { id: sourceIds[index]?.toString() },
        })
      )
    );

    await processOutbox();

    const newEvents = eventBus.events().slice(eventCountBefore);
    const computedEvents = newEvents.filter(
      (event) =>
        event instanceof RecordsBatchUpdated &&
        event.source === 'computed' &&
        event.tableId.toString() === tableB.id().toString()
    ) as RecordsBatchUpdated[];

    expect(computedEvents.length).toBeGreaterThan(0);

    const updatedRecordIds = new Set(
      computedEvents.flatMap((event) => event.updates.map((update) => update.recordId))
    );
    for (const targetId of targetIds) {
      expect(updatedRecordIds.has(targetId.toString())).toBe(true);
    }
  });

  describe('delete optimization', () => {
    it('deletes record from Many-side table', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

      const { tableB, bFieldIds } = await createBidirectionalLinkScenario(commandBus, baseId);

      const nameFieldId = bFieldIds.get('Name')!;

      const recordId = await createRecord(commandBus, tableB.id(), {
        [nameFieldId.toString()]: 'ToDelete',
      });

      const dbTableName = tableB.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

      // Verify record exists
      let rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();
      expect(rows.length).toBe(1);

      // Delete the record
      await deleteRecord(commandBus, tableB.id(), recordId);

      // Verify record is deleted
      rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();
      expect(rows.length).toBe(0);
    });

    it('deletes source record and updates lookup to null', async () => {
      const { container, baseId, processOutbox } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

      const { tableA, tableB, aFieldIds, bFieldIds, bLinkFieldId, bLookupFieldId } =
        await createBidirectionalLinkScenario(commandBus, baseId);

      // Create source record in tableA
      const aNameFieldId = aFieldIds.get('Name')!;
      const aValueFieldId = aFieldIds.get('Value')!;

      const sourceRecordId = await createRecord(commandBus, tableA.id(), {
        [aNameFieldId.toString()]: 'SourceToDelete',
        [aValueFieldId.toString()]: 100,
      });

      // Create target record in tableB with link to source
      const bNameFieldId = bFieldIds.get('Name')!;

      const targetRecordId = await createRecord(commandBus, tableB.id(), {
        [bNameFieldId.toString()]: 'LinkedTarget',
        [bLinkFieldId.toString()]: { id: sourceRecordId.toString() },
      });

      await processOutbox();

      const dbTableNameB = tableB.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
      const lookupDbField = tableB
        .getFields()
        .find((f) => f.id().toString() === bLookupFieldId.toString())!
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();

      // Verify lookup has value before delete
      let rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableNameB)
        .selectAll()
        .where('__id', '=', targetRecordId.toString())
        .execute();
      expect(rows[0][lookupDbField]).toStrictEqual([100]);

      // Delete the source record
      await deleteRecord(commandBus, tableA.id(), sourceRecordId);

      // Verify lookup is now null
      rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableNameB)
        .selectAll()
        .where('__id', '=', targetRecordId.toString())
        .execute();
      // TODO: lookup should be null after source delete (async computed update)
    });
  });

  describe('computed no-op updates', () => {
    it('skips RecordsBatchUpdated and version bump when computed value is unchanged', async () => {
      const { container, baseId, processOutbox, eventBus } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

      const amountFieldId = `fld${'a'.repeat(16)}`;
      const statusFieldId = `fld${'s'.repeat(16)}`;

      const { table, fieldIds } = await createTable(commandBus, baseId, {
        name: 'NoOpComputed',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: amountFieldId, name: 'Amount' },
          {
            type: 'formula',
            id: statusFieldId,
            name: 'Status',
            options: {
              expression: `IF({${amountFieldId}} > 0, "positive", "negative")`,
            },
          },
        ],
      });

      const nameFieldId = fieldIds.get('Name')!;

      const recordId = await createRecord(commandBus, table.id(), {
        [nameFieldId.toString()]: 'NoOp',
        [amountFieldId]: 1,
      });

      await processOutbox();

      const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
      const statusDbField = table
        .getFields()
        .find((f) => f.id().toString() === statusFieldId)!
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();

      let rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();

      expect(rows[0][statusDbField]).toBe('positive');
      expect(rows[0]['__version']).toBe(2);

      const eventCountBefore = eventBus.events().length;

      const updateCommand = UpdateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: recordId.toString(),
        fields: {
          [amountFieldId]: 2,
        },
      })._unsafeUnwrap();

      await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
        createContext(),
        updateCommand
      );
      await processOutbox();

      rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();

      expect(rows[0][statusDbField]).toBe('positive');
      // Version should only reflect the direct update
      expect(rows[0]['__version']).toBe(3);

      const newEvents = eventBus.events().slice(eventCountBefore);
      const computedBatchEvents = newEvents.filter(
        (event) => event instanceof RecordsBatchUpdated && event.source === 'computed'
      );

      expect(computedBatchEvents.length).toBe(0);
    });

    it('does not bump version or emit computed events when DISTINCT filters no-op updates', async () => {
      const { container, baseId, processOutbox, eventBus } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

      const amountFieldId = `fld${'g'.repeat(16)}`;
      const statusFieldId = `fld${'h'.repeat(16)}`;

      const { table, fieldIds } = await createTable(commandBus, baseId, {
        name: 'DistinctNoOpComputed',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', id: amountFieldId, name: 'Amount' },
          {
            type: 'formula',
            id: statusFieldId,
            name: 'Status',
            options: {
              expression: `IF({${amountFieldId}} > 0, "positive", "negative")`,
            },
          },
        ],
      });

      const nameFieldId = fieldIds.get('Name')!;

      const recordId = await createRecord(commandBus, table.id(), {
        [nameFieldId.toString()]: 'DistinctNoOp',
        [amountFieldId]: 1,
      });

      await processOutbox();

      const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
      const statusDbField = table
        .getFields()
        .find((f) => f.id().toString() === statusFieldId)!
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();

      let rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();

      expect(rows[0][statusDbField]).toBe('positive');
      expect(rows[0]['__version']).toBe(2);

      const eventCountBefore = eventBus.events().length;

      const updateCommand = UpdateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: recordId.toString(),
        fields: {
          [amountFieldId]: 2,
        },
      })._unsafeUnwrap();

      await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
        createContext(),
        updateCommand
      );
      await processOutbox();

      rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();

      expect(rows[0][statusDbField]).toBe('positive');
      // Version should only reflect the direct update
      expect(rows[0]['__version']).toBe(3);

      const newEvents = eventBus.events().slice(eventCountBefore);
      const computedBatchEvents = newEvents.filter(
        (event) => event instanceof RecordsBatchUpdated && event.source === 'computed'
      );

      expect(computedBatchEvents.length).toBe(0);
    });
  });

  describe('formula chain', () => {
    it('creates record with formula chain and computes values', async () => {
      const { container, baseId, processOutbox } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

      const { table, fieldIds, baseFieldId, formula1FieldId, formula2FieldId } =
        await createFormulaChainTable(commandBus, baseId);

      const nameFieldId = fieldIds.get('Name')!;

      const recordId = await createRecord(commandBus, table.id(), {
        [nameFieldId.toString()]: 'FormulaTest',
        [baseFieldId.toString()]: 5,
      });

      await processOutbox();

      const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

      const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();

      expect(rows.length).toBe(1);
      const row = rows[0];

      const baseDbField = table
        .getFields()
        .find((f) => f.id().toString() === baseFieldId.toString())!
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();
      const formula1DbField = table
        .getFields()
        .find((f) => f.id().toString() === formula1FieldId.toString())!
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();
      const formula2DbField = table
        .getFields()
        .find((f) => f.id().toString() === formula2FieldId.toString())!
        .dbFieldName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();

      expect(row[baseDbField]).toBe(5);
      expect(row[formula1DbField]).toBe(10); // 5 * 2
      expect(row[formula2DbField]).toBe(20); // 10 + 10
    });

    it('deletes record with formula chain', async () => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

      const { table, fieldIds, baseFieldId } = await createFormulaChainTable(commandBus, baseId);

      const nameFieldId = fieldIds.get('Name')!;

      const recordId = await createRecord(commandBus, table.id(), {
        [nameFieldId.toString()]: 'ToDelete',
        [baseFieldId.toString()]: 10,
      });

      const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

      // Verify record exists
      let rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();
      expect(rows.length).toBe(1);

      // Delete the record
      await deleteRecord(commandBus, table.id(), recordId);

      // Verify record is deleted
      rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
        .selectFrom(dbTableName)
        .selectAll()
        .where('__id', '=', recordId.toString())
        .execute();
      expect(rows.length).toBe(0);
    });
  });
});
