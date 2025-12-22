/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-empty-function */
import {
  ActorId,
  CreateTableCommand,
  type CreateTableResult,
  EventHandler,
  type IEventHandler,
  type ICommandBus,
  type IExecutionContext,
  type ITableSchemaRepository,
  Table,
  TableCreated,
  v2CoreTokens,
} from '@teable/v2-core';
import { injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { getV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

describe('CreateTableHandler', () => {
  it('returns ok and publishes TableCreated', async () => {
    const { container, tableRepository, eventBus, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Projects',
      fields: [
        { type: 'singleLineText', name: 'Name', options: { defaultValue: 'Project' } },
        {
          type: 'rating',
          name: 'Priority',
          options: { max: 5, icon: 'star', color: 'yellowBright' },
        },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { name: 'Todo', color: 'blue' },
              { name: 'Doing', color: 'yellow' },
              { name: 'Done', color: 'green' },
            ],
          },
        },
      ],
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult.value
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(eventBus.events().some((e) => e instanceof TableCreated)).toBe(true);
    expect(result.value.table.primaryFieldId().equals(result.value.table.fields()[0].id())).toBe(
      true
    );
    expect(result.value.table.baseId().equals(baseId)).toBe(true);

    const specResult = Table.specs(baseId).byId(result.value.table.id()).build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;
    const savedResult = await tableRepository.findOne(context, specResult.value);
    expect(savedResult.isOk()).toBe(true);
    if (savedResult.isOk()) {
      expect(savedResult.value.primaryFieldId().equals(result.value.table.primaryFieldId())).toBe(
        true
      );
    }
  });

  it('supports non-text primary field', async () => {
    const { container, tableRepository, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Projects',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        {
          type: 'rating',
          name: 'Priority',
          isPrimary: true,
          options: { max: 5, icon: 'star', color: 'yellowBright' },
        },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { name: 'Todo', color: 'blue' },
              { name: 'Doing', color: 'yellow' },
              { name: 'Done', color: 'green' },
            ],
          },
        },
      ],
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult.value
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.table.primaryFieldId().equals(result.value.table.fields()[1].id())).toBe(
      true
    );

    const specResult = Table.specs(baseId).byId(result.value.table.id()).build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;
    const savedResult = await tableRepository.findOne(context, specResult.value);
    expect(savedResult.isOk()).toBe(true);
    if (savedResult.isErr()) return;
    expect(savedResult.value.primaryFieldId().equals(result.value.table.primaryFieldId())).toBe(
      true
    );
  });

  it('creates tables with the same name without db table conflicts', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const commandResultOne = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Duplicate',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    const commandResultTwo = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Duplicate',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });

    expect(commandResultOne.isOk()).toBe(true);
    expect(commandResultTwo.isOk()).toBe(true);
    if (commandResultOne.isErr() || commandResultTwo.isErr()) return;

    const resultOne = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResultOne.value
    );
    expect(resultOne.isOk()).toBe(true);
    if (resultOne.isErr()) return;

    const resultTwo = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResultTwo.value
    );
    expect(resultTwo.isOk()).toBe(true);
    if (resultTwo.isErr()) return;

    expect(resultOne.value.table.id().equals(resultTwo.value.table.id())).toBe(false);
  });

  it('creates tables with all base field types', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'All Fields',
      fields: [
        {
          type: 'singleLineText',
          name: 'Name',
          options: { showAs: { type: 'email' }, defaultValue: 'owner@example.com' },
        },
        { type: 'longText', name: 'Description', options: { defaultValue: 'Details' } },
        {
          type: 'number',
          name: 'Amount',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'bar', color: 'teal', showValue: true, maxValue: 100 },
            defaultValue: 10,
          },
        },
        {
          type: 'rating',
          name: 'Priority',
          options: { max: 5, icon: 'star', color: 'yellowBright' },
        },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { name: 'Todo', color: 'blue' },
              { name: 'Doing', color: 'yellow' },
              { name: 'Done', color: 'green' },
            ],
            defaultValue: 'Todo',
            preventAutoNewOptions: true,
          },
        },
        {
          type: 'multipleSelect',
          name: 'Tags',
          options: {
            choices: [
              { name: 'Frontend', color: 'purple' },
              { name: 'Backend', color: 'orange' },
              { name: 'Bug', color: 'red' },
            ],
            defaultValue: ['Frontend', 'Bug'],
          },
        },
        { type: 'checkbox', name: 'Done', options: { defaultValue: true } },
        { type: 'attachment', name: 'Files' },
        {
          type: 'date',
          name: 'Due Date',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
        },
        {
          type: 'user',
          name: 'Owner',
          options: { isMultiple: true, shouldNotify: false, defaultValue: ['me'] },
        },
        {
          type: 'button',
          name: 'Action',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 3,
            resetCount: true,
            workflow: { id: `wfl${'a'.repeat(16)}`, name: 'Deploy', isActive: true },
          },
        },
      ],
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult.value
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.table.fields().map((f) => f.type().toString())).toEqual([
      'singleLineText',
      'longText',
      'number',
      'rating',
      'singleSelect',
      'multipleSelect',
      'checkbox',
      'attachment',
      'date',
      'user',
      'button',
    ]);
  });

  it('supports multiple view types', async () => {
    const { container, tableRepository, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Projects',
      fields: [{ type: 'singleLineText', name: 'Name' }],
      views: [{ type: 'kanban' }, { type: 'grid', name: 'All Records' }],
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult.value
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.table.views().map((v) => v.type().toString())).toEqual(['kanban', 'grid']);
    expect(result.value.table.views().map((v) => v.name().toString())).toEqual([
      'Kanban',
      'All Records',
    ]);

    const specResult = Table.specs(baseId).byId(result.value.table.id()).build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;
    const savedResult = await tableRepository.findOne(context, specResult.value);
    expect(savedResult.isOk()).toBe(true);
    if (savedResult.isErr()) return;
    expect(savedResult.value.views().map((v) => v.type().toString())).toEqual(['kanban', 'grid']);
  });

  it('returns err when schema save fails', async () => {
    const { container, baseId } = getV2NodeTestContainer();

    class FailingTableSchemaRepository implements ITableSchemaRepository {
      async insert(_: IExecutionContext, __: Table) {
        return err('Forced schema failure');
      }
    }

    container.registerInstance(
      v2CoreTokens.tableSchemaRepository,
      new FailingTableSchemaRepository()
    );

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const tableName = `Rollback ${Date.now()}`;
    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: tableName,
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult.value
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe('Forced schema failure');
    }
  });

  it('dispatches TableCreated event handlers', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const handledEvents: TableCreated[] = [];

    @EventHandler(TableCreated)
    @injectable()
    class TestTableCreatedHandler implements IEventHandler<TableCreated> {
      async handle(_: IExecutionContext, event: TableCreated) {
        handledEvents.push(event);
        return ok(undefined);
      }
    }

    container.registerInstance(TestTableCreatedHandler, new TestTableCreatedHandler());

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Events',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult.value
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(handledEvents.length).toBe(1);
    expect(handledEvents[0].tableId.equals(result.value.table.id())).toBe(true);
  });
});
