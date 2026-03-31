/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Integration tests for formula type compatibility in computed updates.
 *
 * These tests cover v1 integration scenarios (FORCE_V2_ALL / sync computed mode)
 * where computed updates compare stored columns against computed SELECT values.
 * The comparison must not throw type mismatch errors and should treat blank
 * branches as nulls for numeric/date results.
 */
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  type ITableRecordQueryRepository,
  UpdateRecordCommand,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  type UpdateRecordResult,
  v2CoreTokens,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

let fieldIdCounter = 0;
const createFieldId = (): string => {
  const suffix = (++fieldIdCounter).toString(16).padStart(16, '0');
  return `fld${suffix}`;
};

describe('Computed Formula Type Compatibility (db)', () => {
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

  it('treats numeric IF blank branches as nulls without type errors', async () => {
    const { container, baseId, processOutbox } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const recordQueryRepository = container.resolve<ITableRecordQueryRepository>(
      v2CoreTokens.tableRecordQueryRepository
    );

    const titleFieldId = createFieldId();
    const numberFieldId = createFieldId();
    const formulaFieldId = createFieldId();

    const tableCommand = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'IfNumericBlank',
      fields: [
        { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
        { type: 'number', id: numberFieldId, name: 'Value' },
        {
          type: 'formula',
          id: formulaFieldId,
          name: 'IfValue',
          options: {
            expression: `IF({${numberFieldId}} > 0, {${numberFieldId}}, "")`,
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
        [numberFieldId]: 1,
      },
    })._unsafeUnwrap();

    const createResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    const { record } = createResult._unsafeUnwrap();

    await processOutbox();

    const initialResult = await recordQueryRepository.findOne(createContext(), table, record.id(), {
      mode: 'stored',
    });
    if (initialResult.isErr()) {
      throw new Error(`stored query failed: ${initialResult.error.message}`);
    }
    let storedRecord = initialResult.value;
    expect(storedRecord.fields[formulaFieldId]).not.toBeNull();
    expect(Number(storedRecord.fields[formulaFieldId])).toBe(1);

    const updateCommand = UpdateRecordCommand.create({
      tableId: table.id().toString(),
      recordId: record.id().toString(),
      fields: {
        [numberFieldId]: -1,
      },
    })._unsafeUnwrap();

    await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      createContext(),
      updateCommand
    );

    await processOutbox();

    const updatedResult = await recordQueryRepository.findOne(createContext(), table, record.id(), {
      mode: 'stored',
    });
    if (updatedResult.isErr()) {
      throw new Error(`stored query failed: ${updatedResult.error.message}`);
    }
    storedRecord = updatedResult.value;
    expect(storedRecord.fields[formulaFieldId]).toBeNull();
  });

  it('treats SWITCH numeric blank branches as nulls without type errors', async () => {
    const { container, baseId, processOutbox } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const recordQueryRepository = container.resolve<ITableRecordQueryRepository>(
      v2CoreTokens.tableRecordQueryRepository
    );

    const titleFieldId = createFieldId();
    const numberFieldId = createFieldId();
    const formulaFieldId = createFieldId();

    const tableCommand = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'SwitchNumericBlank',
      fields: [
        { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
        { type: 'number', id: numberFieldId, name: 'Value' },
        {
          type: 'formula',
          id: formulaFieldId,
          name: 'SwitchValue',
          options: {
            expression: `SWITCH({${numberFieldId}}, 1.23, "", 2.34, "", 0)`,
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
        [numberFieldId]: 1.23,
      },
    })._unsafeUnwrap();

    const createResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    const { record } = createResult._unsafeUnwrap();

    await processOutbox();

    let storedRecord = (
      await recordQueryRepository.findOne(createContext(), table, record.id(), { mode: 'stored' })
    )._unsafeUnwrap();
    expect(storedRecord.fields[formulaFieldId]).toBeNull();

    const updateCommand = UpdateRecordCommand.create({
      tableId: table.id().toString(),
      recordId: record.id().toString(),
      fields: {
        [numberFieldId]: 3,
      },
    })._unsafeUnwrap();

    await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      createContext(),
      updateCommand
    );

    await processOutbox();

    storedRecord = (
      await recordQueryRepository.findOne(createContext(), table, record.id(), { mode: 'stored' })
    )._unsafeUnwrap();
    expect(storedRecord.fields[formulaFieldId]).not.toBeNull();
  });

  it('coerces blank IF branch to null for datetime results', async () => {
    const { container, baseId, processOutbox } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const recordQueryRepository = container.resolve<ITableRecordQueryRepository>(
      v2CoreTokens.tableRecordQueryRepository
    );

    const titleFieldId = createFieldId();
    const activeFieldId = createFieldId();
    const createdTimeFieldId = createFieldId();
    const formulaFieldId = createFieldId();

    const tableCommandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'IfDateBlank',
      fields: [
        { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
        { type: 'checkbox', id: activeFieldId, name: 'Active' },
        { type: 'createdTime', id: createdTimeFieldId, name: 'CreatedAt' },
        {
          type: 'formula',
          id: formulaFieldId,
          name: 'IfDate',
          options: {
            expression: `IF({${activeFieldId}}, {${createdTimeFieldId}}, "")`,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    if (tableCommandResult.isErr()) {
      throw new Error(`create table failed: ${JSON.stringify(tableCommandResult.error)}`);
    }
    const tableCommand = tableCommandResult.value;

    const tableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      tableCommand
    );
    const { table } = tableResult._unsafeUnwrap();

    const createRecordResult = CreateRecordCommand.create({
      tableId: table.id().toString(),
      fields: {
        [titleFieldId]: 'Test',
        [activeFieldId]: true,
      },
    });
    if (createRecordResult.isErr()) {
      throw new Error(`create record failed: ${createRecordResult.error.message}`);
    }
    const createRecordCommand = createRecordResult.value;

    const createResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    const { record } = createResult._unsafeUnwrap();

    await processOutbox();

    let storedRecord = (
      await recordQueryRepository.findOne(createContext(), table, record.id(), { mode: 'stored' })
    )._unsafeUnwrap();
    expect(storedRecord.fields[formulaFieldId]).not.toBeNull();

    const updateResult = UpdateRecordCommand.create({
      tableId: table.id().toString(),
      recordId: record.id().toString(),
      fields: {
        [activeFieldId]: false,
      },
    });
    if (updateResult.isErr()) {
      throw new Error(`update record failed: ${updateResult.error.message}`);
    }
    const updateCommand = updateResult.value;

    await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      createContext(),
      updateCommand
    );

    await processOutbox();

    storedRecord = (
      await recordQueryRepository.findOne(createContext(), table, record.id(), { mode: 'stored' })
    )._unsafeUnwrap();
    expect(storedRecord.fields[formulaFieldId]).toBeNull();
  });
});
