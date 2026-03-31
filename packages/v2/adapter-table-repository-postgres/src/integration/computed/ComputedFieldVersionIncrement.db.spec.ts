/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Integration tests for computed field version increment behavior.
 *
 * These tests verify that computed field updates properly increment __version,
 * which is critical for ShareDB real-time sync to work correctly.
 *
 * Background:
 * - V1 increments __version for BOTH direct updates AND computed updates
 * - V2 previously only incremented __version for direct updates
 * - This caused ShareDB client version to drift from database version
 * - We fixed this by adding __version increment to computed update SET clause
 */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  FieldId,
  UpdateRecordCommand,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  type UpdateRecordResult,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

// Helper to generate deterministic field IDs for tests
let fieldIdCounter = 0;
const createFieldId = (): string => {
  const suffix = (++fieldIdCounter).toString(16).padStart(16, '0');
  return `fld${suffix}`;
};

describe('Computed Field Version Increment (db)', () => {
  let testContainer: IV2NodeTestContainer;

  beforeEach(async () => {
    await getV2NodeTestContainer().dispose();
    testContainer = await createV2NodeTestContainer();
    setV2NodeTestContainer(testContainer);
    fieldIdCounter = 0;
  });

  afterEach(async () => {
    await getV2NodeTestContainer().dispose();
  });

  const createContext = () => {
    const actorIdResult = ActorId.create('system');
    return { actorId: actorIdResult._unsafeUnwrap() };
  };

  it('increments __version when updating a field that triggers formula computation', async () => {
    const { container, baseId } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    // Pre-generate field IDs to use in formula expression
    const titleFieldId = createFieldId();
    const amountFieldId = createFieldId();
    const formulaFieldId = createFieldId();

    // Create a table with a number field and a formula field
    const tableCommand = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'VersionTest',
      fields: [
        { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
        { type: 'number', id: amountFieldId, name: 'Amount' },
        {
          type: 'formula',
          id: formulaFieldId,
          name: 'DoubleAmount',
          options: { expression: `{${amountFieldId}} * 2` },
        },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const tableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      tableCommand
    );
    const { table } = tableResult._unsafeUnwrap();
    const tableId = table.id().toString();

    const formulaField = table
      .getFields()
      .find((f) => f.id().equals(FieldId.create(formulaFieldId)._unsafeUnwrap()))!;

    // Create a record
    const createRecordCommand = CreateRecordCommand.create({
      tableId,
      fields: {
        [titleFieldId]: 'Test',
        [amountFieldId]: 10,
      },
    })._unsafeUnwrap();

    const createResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    const { record } = createResult._unsafeUnwrap();

    // Process outbox to compute initial formula value
    await testContainer.processOutbox();

    // Get initial version (should be 2 after creation + formula computation)
    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const formulaDbField = formulaField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    const initialRows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    expect(initialRows.length).toBe(1);
    // Version 1 (creation) + Version 2 (computed update)
    expect(initialRows[0]['__version']).toBe(2);
    expect(initialRows[0][formulaDbField]).toBe(20); // 10 * 2

    // Update the source field to trigger formula recomputation
    const updateCommand = UpdateRecordCommand.create({
      tableId,
      recordId: record.id().toString(),
      fields: {
        [amountFieldId]: 25,
      },
    })._unsafeUnwrap();

    await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      createContext(),
      updateCommand
    );

    // Process outbox to ensure computed update is executed
    await testContainer.processOutbox();

    // Check final version - should be 4:
    // - Version 1: Initial creation
    // - Version 2: Computed update for DoubleAmount (initial formula)
    // - Version 3: Direct update to Amount field
    // - Version 4: Computed update to DoubleAmount field (formula recompute)
    const finalRows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    expect(finalRows.length).toBe(1);
    expect(finalRows[0][formulaDbField]).toBe(50); // 25 * 2
    // This is the key assertion: computed update should have incremented version
    expect(finalRows[0]['__version']).toBe(4);
  });

  it('does not increment __version when computed value is unchanged', async () => {
    const { container, baseId, processOutbox } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const titleFieldId = createFieldId();
    const amountFieldId = createFieldId();
    const statusFieldId = createFieldId();

    const tableCommand = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'NoOpVersionTest',
      fields: [
        { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
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
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const tableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      tableCommand
    );
    const { table } = tableResult._unsafeUnwrap();

    const createRecordCommand = CreateRecordCommand.create({
      tableId: table.id().toString(),
      fields: {
        [titleFieldId]: 'Test',
        [amountFieldId]: 1,
      },
    })._unsafeUnwrap();

    const createResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    const { record } = createResult._unsafeUnwrap();

    await processOutbox();

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const statusDbField = table
      .getFields()
      .find((f) => f.id().equals(FieldId.create(statusFieldId)._unsafeUnwrap()))!
      .dbFieldName()
      ._unsafeUnwrap()
      .value()
      ._unsafeUnwrap();

    let rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    expect(rows.length).toBe(1);
    expect(rows[0][statusDbField]).toBe('positive');
    expect(rows[0]['__version']).toBe(2);

    const updateCommand = UpdateRecordCommand.create({
      tableId: table.id().toString(),
      recordId: record.id().toString(),
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
      .where('__id', '=', record.id().toString())
      .execute();

    expect(rows.length).toBe(1);
    expect(rows[0][statusDbField]).toBe('positive');
    // Version should only advance for the direct update (no computed update bump)
    expect(rows[0]['__version']).toBe(3);
  });

  it('increments __version correctly for formula chain updates', async () => {
    const { container, baseId } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    // Pre-generate field IDs
    const titleFieldId = createFieldId();
    const valueFieldId = createFieldId();
    const step1FieldId = createFieldId();
    const step2FieldId = createFieldId();

    // Create a table with chained formula fields
    const tableCommand = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'ChainVersionTest',
      fields: [
        { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
        { type: 'number', id: valueFieldId, name: 'Value' },
        {
          type: 'formula',
          id: step1FieldId,
          name: 'Step1',
          options: { expression: `{${valueFieldId}} + 1` },
        },
        {
          type: 'formula',
          id: step2FieldId,
          name: 'Step2',
          options: { expression: `{${step1FieldId}} + 1` },
        },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const tableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      tableCommand
    );
    const { table } = tableResult._unsafeUnwrap();
    const tableId = table.id().toString();

    const step1Field = table
      .getFields()
      .find((f) => f.id().equals(FieldId.create(step1FieldId)._unsafeUnwrap()))!;
    const step2Field = table
      .getFields()
      .find((f) => f.id().equals(FieldId.create(step2FieldId)._unsafeUnwrap()))!;

    // Create a record
    const createRecordCommand = CreateRecordCommand.create({
      tableId,
      fields: {
        [titleFieldId]: 'Chain Test',
        [valueFieldId]: 1,
      },
    })._unsafeUnwrap();

    const createResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    const { record } = createResult._unsafeUnwrap();

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const step1DbField = step1Field.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const step2DbField = step2Field.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    // Process outbox to compute initial formula values
    await testContainer.processOutbox();
    await testContainer.processOutbox();

    // Verify initial values
    const initialRows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    // Version may be 2 or 3 depending on batching of initial formula computation
    expect(initialRows[0]['__version'] as number).toBeGreaterThanOrEqual(2);
    expect(initialRows[0][step1DbField]).toBe(2); // 1 + 1
    expect(initialRows[0][step2DbField]).toBe(3); // 2 + 1

    const initialVersion = initialRows[0]['__version'] as number;

    // Update the source field
    const updateCommand = UpdateRecordCommand.create({
      tableId,
      recordId: record.id().toString(),
      fields: {
        [valueFieldId]: 10,
      },
    })._unsafeUnwrap();

    await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      createContext(),
      updateCommand
    );

    // Process outbox for all computed steps
    await testContainer.processOutbox();
    await testContainer.processOutbox();

    // Check final values and version
    const finalRows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    expect(finalRows[0][step1DbField]).toBe(11); // 10 + 1
    expect(finalRows[0][step2DbField]).toBe(12); // 11 + 1

    // Version should be incremented for:
    // - Direct update (initialVersion + 1)
    // - Computed update for Step1 and Step2 (may be batched, at least +1 more)
    const finalVersion = finalRows[0]['__version'] as number;
    // At minimum: initialVersion + 1 (direct) + 1 (computed) = initialVersion + 2
    expect(finalVersion).toBeGreaterThanOrEqual(initialVersion + 2);
  });

  it('increments __version for multiple records in same computed batch', async () => {
    const { container, baseId } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    // Pre-generate field IDs
    const titleFieldId = createFieldId();
    const amountFieldId = createFieldId();
    const formulaFieldId = createFieldId();

    // Create a table with a formula field
    const tableCommand = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'BatchVersionTest',
      fields: [
        { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
        { type: 'number', id: amountFieldId, name: 'Amount' },
        {
          type: 'formula',
          id: formulaFieldId,
          name: 'Triple',
          options: { expression: `{${amountFieldId}} * 3` },
        },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const tableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      tableCommand
    );
    const { table } = tableResult._unsafeUnwrap();
    const tableId = table.id().toString();

    const formulaField = table
      .getFields()
      .find((f) => f.id().equals(FieldId.create(formulaFieldId)._unsafeUnwrap()))!;

    // Create two records
    const createRecord1 = CreateRecordCommand.create({
      tableId,
      fields: {
        [titleFieldId]: 'Record 1',
        [amountFieldId]: 5,
      },
    })._unsafeUnwrap();

    const createRecord2 = CreateRecordCommand.create({
      tableId,
      fields: {
        [titleFieldId]: 'Record 2',
        [amountFieldId]: 10,
      },
    })._unsafeUnwrap();

    const result1 = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecord1
    );
    const record1 = result1._unsafeUnwrap().record;

    const result2 = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecord2
    );
    const record2 = result2._unsafeUnwrap().record;

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const formulaDbField = formulaField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    // Process outbox to compute initial formula values for both records
    await testContainer.processOutbox();

    // Update both records
    const update1 = UpdateRecordCommand.create({
      tableId,
      recordId: record1.id().toString(),
      fields: { [amountFieldId]: 7 },
    })._unsafeUnwrap();

    const update2 = UpdateRecordCommand.create({
      tableId,
      recordId: record2.id().toString(),
      fields: { [amountFieldId]: 14 },
    })._unsafeUnwrap();

    await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(createContext(), update1);
    await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(createContext(), update2);

    // Process outbox
    await testContainer.processOutbox();

    // Check both records have correct formula values and incremented versions
    const finalRows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .execute();

    const row1 = finalRows.find((r) => r['__id'] === record1.id().toString())!;
    const row2 = finalRows.find((r) => r['__id'] === record2.id().toString())!;

    expect(row1[formulaDbField]).toBe(21); // 7 * 3
    expect(row2[formulaDbField]).toBe(42); // 14 * 3

    // Both records should have version incremented by computed update
    // Creation (1) + Initial computed (2) + Direct update (3) + Computed update (4)
    expect(row1['__version']).toBe(4);
    expect(row2['__version']).toBe(4);
  });
});
