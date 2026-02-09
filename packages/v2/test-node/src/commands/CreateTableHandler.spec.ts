/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-empty-function */
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateTableCommand,
  type CreateTableResult,
  EventHandler,
  type IEventHandler,
  type ICommandBus,
  type IExecutionContext,
  type IQueryBus,
  type ISpecification,
  ListTableRecordsQuery,
  type ListTableRecordsResult,
  type LinkField,
  type FormulaField,
  type RollupField,
  type Table,
  type DomainError,
  type ITableSchemaRepository,
  type ITableSpecVisitor,
  FieldValueTypeVisitor,
  TableCreated,
  v2CoreTokens,
} from '@teable/v2-core';
import { domainError } from '@teable/v2-core';
import { injectable } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';
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

    commandResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult._unsafeUnwrap()
    );
    const createdTable = result._unsafeUnwrap().table;

    expect(eventBus.events().some((e) => e instanceof TableCreated)).toBe(true);
    expect(createdTable.primaryFieldId().equals(createdTable.getFields()[0].id())).toBe(true);
    expect(createdTable.baseId().equals(baseId)).toBe(true);

    const specResult = createdTable.specs().byId(createdTable.id()).build();
    specResult._unsafeUnwrap();

    const savedResult = await tableRepository.findOne(context, specResult._unsafeUnwrap());
    const savedTable = savedResult._unsafeUnwrap();
    expect(savedTable.primaryFieldId().equals(createdTable.primaryFieldId())).toBe(true);
  });

  it('creates records when provided', async () => {
    const { container, baseId, dispose } = await createV2NodeTestContainer();
    try {
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
      const nameFieldId = `fld${'r'.repeat(16)}`;

      const commandResult = CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Seeded Table',
        fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
        records: [{ fields: { [nameFieldId]: 'Alpha' } }, { fields: { [nameFieldId]: 'Beta' } }],
      });
      commandResult._unsafeUnwrap();

      const actorIdResult = ActorId.create('system');
      actorIdResult._unsafeUnwrap();
      const context = { actorId: actorIdResult._unsafeUnwrap() };

      const createResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        context,
        commandResult._unsafeUnwrap()
      );
      const createdTable = createResult._unsafeUnwrap().table;

      const listQuery = ListTableRecordsQuery.create({
        tableId: createdTable.id().toString(),
        limit: 10,
        offset: 0,
      });
      listQuery._unsafeUnwrap();

      const listResult = await queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
        context,
        listQuery._unsafeUnwrap()
      );
      const records = listResult._unsafeUnwrap().records;
      expect(records).toHaveLength(2);
      const values = records.map((record) => record.fields[nameFieldId]);
      expect(values).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    } finally {
      await dispose();
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

    commandResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult._unsafeUnwrap()
    );
    const createdTable = result._unsafeUnwrap().table;

    expect(createdTable.primaryFieldId().equals(createdTable.getFields()[1].id())).toBe(true);

    const specResult = createdTable.specs().byId(createdTable.id()).build();
    specResult._unsafeUnwrap();

    const savedResult = await tableRepository.findOne(context, specResult._unsafeUnwrap());
    savedResult._unsafeUnwrap();

    expect(savedResult._unsafeUnwrap().primaryFieldId().equals(createdTable.primaryFieldId())).toBe(
      true
    );
  });

  it('creates tables when rollup and formula fields reference later inputs', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();
    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const foreignCommandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Companies',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    foreignCommandResult._unsafeUnwrap();

    const foreignResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      foreignCommandResult._unsafeUnwrap()
    );

    const foreignTable = foreignResult._unsafeUnwrap().table;
    const lookupFieldId = foreignTable.primaryFieldId().toString();
    const linkFieldId = `fld${'l'.repeat(16)}`;
    const numberFieldId = `fld${'n'.repeat(16)}`;

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Out Of Order',
      fields: [
        {
          type: 'rollup',
          name: 'Rollup Total',
          options: { expression: 'counta({values})' },
          config: {
            linkFieldId,
            foreignTableId: foreignTable.id().toString(),
            lookupFieldId,
          },
        },
        {
          type: 'formula',
          name: 'Score',
          options: { expression: `{${numberFieldId}} + 1` },
        },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Company',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id().toString(),
            lookupFieldId,
          },
        },
        { type: 'number', id: numberFieldId, name: 'Amount' },
        { type: 'singleLineText', name: 'Name', isPrimary: true },
      ],
    });

    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult._unsafeUnwrap()
    );

    const createdTable = result._unsafeUnwrap().table;
    const formulaField = createdTable
      .getFields()
      .find((field) => field.type().toString() === 'formula') as FormulaField | undefined;
    const rollupField = createdTable
      .getFields()
      .find((field) => field.type().toString() === 'rollup') as RollupField | undefined;
    expect(formulaField).toBeDefined();
    expect(rollupField).toBeDefined();
    if (!formulaField || !rollupField) return;
    expect(formulaField.dependencies().some((id) => id.toString() === numberFieldId)).toBe(true);
    expect(rollupField.dependencies().some((id) => id.toString() === linkFieldId)).toBe(true);
  });

  it('creates tables with the same name without db table conflicts', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
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

    const resultOne = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResultOne._unsafeUnwrap()
    );

    const resultTwo = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResultTwo._unsafeUnwrap()
    );

    expect(resultOne._unsafeUnwrap().table.id().equals(resultTwo._unsafeUnwrap().table.id())).toBe(
      false
    );
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

    commandResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult._unsafeUnwrap()
    );

    expect(
      result
        ._unsafeUnwrap()
        .table.getFields()
        .map((f) => f.type().toString())
    ).toEqual([
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

    commandResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult._unsafeUnwrap()
    );
    const createdTable = result._unsafeUnwrap().table;

    expect(createdTable.views().map((v) => v.type().toString())).toEqual(['kanban', 'grid']);
    expect(createdTable.views().map((v) => v.name().toString())).toEqual(['Kanban', 'All Records']);

    const specResult = createdTable.specs().byId(createdTable.id()).build();
    specResult._unsafeUnwrap();

    const savedResult = await tableRepository.findOne(context, specResult._unsafeUnwrap());
    savedResult._unsafeUnwrap();

    expect(
      savedResult
        ._unsafeUnwrap()
        .views()
        .map((v) => v.type().toString())
    ).toEqual(['kanban', 'grid']);
  });

  it('returns err when schema save fails', async () => {
    const { container, baseId } = getV2NodeTestContainer();

    class FailingTableSchemaRepository implements ITableSchemaRepository {
      private static readonly failureMessage = 'Forced schema failure';

      private fail(): Result<void, DomainError> {
        return err(
          domainError.unexpected({ message: FailingTableSchemaRepository.failureMessage })
        );
      }

      async insert(_: IExecutionContext, __: Table) {
        return this.fail();
      }

      async insertMany(_: IExecutionContext, __: ReadonlyArray<Table>) {
        return this.fail();
      }

      async update(_: IExecutionContext, __: Table, ___: ISpecification<Table, ITableSpecVisitor>) {
        return ok(undefined);
      }

      async delete(_: IExecutionContext, __: Table) {
        return ok(undefined);
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

    commandResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult._unsafeUnwrap()
    );
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toBe('Forced schema failure');
  });

  it('creates formula fields and resolves dependencies', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const amountId = `fld${'a'.repeat(16)}`;
    const scoreId = `fld${'b'.repeat(16)}`;
    const scoreLabelId = `fld${'c'.repeat(16)}`;

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Metrics',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'number', id: amountId, name: 'Amount' },
        {
          type: 'formula',
          id: scoreId,
          name: 'Score',
          options: { expression: `{${amountId}} * 2` },
        },
        {
          type: 'formula',
          id: scoreLabelId,
          name: 'Score Label',
          options: { expression: `CONCATENATE("Score: ", {${scoreId}})` },
        },
      ],
    });

    commandResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult._unsafeUnwrap()
    );

    const table = result._unsafeUnwrap().table;
    const byId = new Map(table.getFields().map((field) => [field.id().toString(), field]));
    const scoreField = byId.get(scoreId);
    const scoreLabelField = byId.get(scoreLabelId);
    const amountField = byId.get(amountId);
    expect(scoreField).toBeTruthy();
    expect(scoreLabelField).toBeTruthy();
    expect(amountField).toBeTruthy();
    if (!scoreField || !scoreLabelField || !amountField) return;

    expect(scoreField.dependencies().map((id) => id.toString())).toEqual([amountId]);
    expect(scoreLabelField.dependencies().map((id) => id.toString())).toEqual([scoreId]);
    expect(amountField.dependents().map((id) => id.toString())).toEqual([scoreId]);
    expect(scoreField.dependents().map((id) => id.toString())).toEqual([scoreLabelId]);

    const valueTypeVisitor = new FieldValueTypeVisitor();
    const scoreType = scoreField.accept(valueTypeVisitor);

    expect(scoreType._unsafeUnwrap().cellValueType.toString()).toBe('number');
    expect(scoreType._unsafeUnwrap().isMultipleCellValue.toBoolean()).toBe(false);

    const scoreLabelType = scoreLabelField.accept(valueTypeVisitor);

    expect(scoreLabelType._unsafeUnwrap().cellValueType.toString()).toBe('string');
    expect(scoreLabelType._unsafeUnwrap().isMultipleCellValue.toBoolean()).toBe(false);
  });

  it('rejects formula cycles', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const formulaAId = `fld${'a'.repeat(16)}`;
    const formulaBId = `fld${'b'.repeat(16)}`;

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Cycle Table',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        {
          type: 'formula',
          id: formulaAId,
          name: 'A',
          options: { expression: `{${formulaBId}} + 1` },
        },
        {
          type: 'formula',
          id: formulaBId,
          name: 'B',
          options: { expression: `{${formulaAId}} + 1` },
        },
      ],
    });

    commandResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult._unsafeUnwrap()
    );
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toContain('Formula field dependency cycle detected');
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

    commandResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult._unsafeUnwrap()
    );

    expect(handledEvents.length).toBe(1);
    expect(handledEvents[0].tableId.equals(result._unsafeUnwrap().table.id())).toBe(true);
  });

  describe('link fields', () => {
    it('creates symmetric fields in the foreign table', async () => {
      const { container, tableRepository, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

      const actorIdResult = ActorId.create('system');
      actorIdResult._unsafeUnwrap();

      const context = { actorId: actorIdResult._unsafeUnwrap() };

      const foreignCommandResult = CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Companies',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      foreignCommandResult._unsafeUnwrap();

      const foreignResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        context,
        foreignCommandResult._unsafeUnwrap()
      );
      foreignResult._unsafeUnwrap();

      const foreignTable = foreignResult._unsafeUnwrap().table;
      const foreignTableId = foreignTable.id().toString();
      const lookupFieldId = foreignTable.primaryFieldId().toString();
      const linkFieldId = `fld${'l'.repeat(16)}`;

      const commandResult = CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Projects',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: linkFieldId,
            name: 'Company',
            options: {
              relationship: 'manyOne',
              foreignTableId,
              lookupFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      commandResult._unsafeUnwrap();

      const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        context,
        commandResult._unsafeUnwrap()
      );

      const specResult = foreignTable.specs().byId(foreignTable.id()).build();
      specResult._unsafeUnwrap();

      const updatedForeignResult = await tableRepository.findOne(
        context,
        specResult._unsafeUnwrap()
      );
      updatedForeignResult._unsafeUnwrap();

      const linkField = updatedForeignResult
        ._unsafeUnwrap()
        .getFields()
        .find((field) => field.type().toString() === 'link') as LinkField | undefined;
      expect(linkField).toBeDefined();
      if (!linkField) return;

      expect(linkField.name().toString()).toBe('Projects');
      expect(linkField.foreignTableId().equals(result._unsafeUnwrap().table.id())).toBe(true);
      expect(linkField.symmetricFieldId()?.toString()).toBe(linkFieldId);
      expect(linkField.relationship().toString()).toBe('oneMany');
      expect(linkField.hasOrderColumn()).toBe(true);
    });
  });
});
