/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  CreateFieldCommand,
  CreateTableCommand,
  type CreateFieldResult,
  type CreateTableResult,
  FieldValueTypeVisitor,
  v2CoreTokens,
  type ButtonField,
  type CheckboxField,
  type DateField,
  type FormulaField,
  type ICommandBus,
  type LongTextField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
  type ITableRepository,
  Table,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { getV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

describe('CreateFieldHandler', () => {
  it('creates all field types with configured options', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    const createTableResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Seed',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    expect(createTableResult.isOk()).toBe(true);
    if (createTableResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const createdTable = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableResult.value
    );
    expect(createdTable.isOk()).toBe(true);
    if (createdTable.isErr()) return;

    const createForeignResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Foreign',
      fields: [{ type: 'singleLineText', name: 'Title' }],
    });
    expect(createForeignResult.isOk()).toBe(true);
    if (createForeignResult.isErr()) return;

    const foreignCreated = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createForeignResult.value
    );
    expect(foreignCreated.isOk()).toBe(true);
    if (foreignCreated.isErr()) return;
    const foreignTable = foreignCreated.value.table;

    const tableId = createdTable.value.table.id().toString();
    const numberFieldId = `fld${'n'.repeat(16)}`;
    const formulaFieldId = `fld${'f'.repeat(16)}`;
    const linkFieldId = `fld${'l'.repeat(16)}`;
    const symmetricLinkFieldId = `fld${'s'.repeat(16)}`;

    const cases = [
      {
        field: {
          type: 'singleLineText',
          id: `fld${'a'.repeat(16)}`,
          name: 'Title',
          options: { showAs: { type: 'email' }, defaultValue: 'Hello' },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.name().toString() === 'Title');
          expect(field?.type().toString()).toBe('singleLineText');
          if (!field) return;
          const typed = field as SingleLineTextField;
          expect(typed.showAs()?.toDto()).toEqual({ type: 'email' });
          expect(typed.defaultValue()?.toString()).toBe('Hello');
        },
      },
      {
        field: {
          type: 'longText',
          id: `fld${'b'.repeat(16)}`,
          name: 'Notes',
          options: { defaultValue: 'Details' },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.name().toString() === 'Notes');
          expect(field?.type().toString()).toBe('longText');
          if (!field) return;
          const typed = field as LongTextField;
          expect(typed.defaultValue()?.toString()).toBe('Details');
        },
      },
      {
        field: {
          type: 'number',
          id: numberFieldId,
          name: 'Amount',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
            defaultValue: 42,
          },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.id().toString() === numberFieldId);
          expect(field?.type().toString()).toBe('number');
          if (!field) return;
          const typed = field as NumberField;
          expect(typed.formatting().toDto()).toEqual({
            type: 'currency',
            precision: 2,
            symbol: '$',
          });
          expect(typed.showAs()?.toDto()).toEqual({
            type: 'bar',
            color: 'red',
            showValue: true,
            maxValue: 100,
          });
          expect(typed.defaultValue()?.toNumber()).toBe(42);
        },
      },
      {
        field: {
          type: 'rating',
          id: `fld${'c'.repeat(16)}`,
          name: 'Priority',
          options: { max: 7, icon: 'star', color: 'yellowBright' },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.name().toString() === 'Priority');
          expect(field?.type().toString()).toBe('rating');
          if (!field) return;
          const typed = field as RatingField;
          expect(typed.ratingMax().toNumber()).toBe(7);
          expect(typed.ratingIcon().toString()).toBe('star');
          expect(typed.ratingColor().toString()).toBe('yellowBright');
        },
      },
      {
        field: {
          type: 'singleSelect',
          id: `fld${'d'.repeat(16)}`,
          name: 'Status',
          options: {
            choices: [
              { id: 'opt1', name: 'Todo', color: 'blue' },
              { id: 'opt2', name: 'Done', color: 'green' },
            ],
            defaultValue: 'Todo',
            preventAutoNewOptions: true,
          },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.name().toString() === 'Status');
          expect(field?.type().toString()).toBe('singleSelect');
          if (!field) return;
          const typed = field as SingleSelectField;
          expect(typed.selectOptions().map((option) => option.toDto())).toEqual([
            { id: 'opt1', name: 'Todo', color: 'blue' },
            { id: 'opt2', name: 'Done', color: 'green' },
          ]);
          expect(typed.defaultValue()?.toDto()).toBe('Todo');
          expect(typed.preventAutoNewOptions().toBoolean()).toBe(true);
        },
      },
      {
        field: {
          type: 'multipleSelect',
          id: `fld${'e'.repeat(16)}`,
          name: 'Tags',
          options: {
            choices: [
              { id: 'opt3', name: 'Alpha', color: 'purple' },
              { id: 'opt4', name: 'Beta', color: 'orange' },
            ],
            defaultValue: ['Alpha', 'Beta'],
          },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.name().toString() === 'Tags');
          expect(field?.type().toString()).toBe('multipleSelect');
          if (!field) return;
          const typed = field as MultipleSelectField;
          expect(typed.selectOptions().map((option) => option.toDto())).toEqual([
            { id: 'opt3', name: 'Alpha', color: 'purple' },
            { id: 'opt4', name: 'Beta', color: 'orange' },
          ]);
          expect(typed.defaultValue()?.toDto()).toEqual(['Alpha', 'Beta']);
        },
      },
      {
        field: {
          type: 'checkbox',
          id: `fld${'g'.repeat(16)}`,
          name: 'Approved',
          options: { defaultValue: true },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.name().toString() === 'Approved');
          expect(field?.type().toString()).toBe('checkbox');
          if (!field) return;
          const typed = field as CheckboxField;
          expect(typed.defaultValue()?.toBoolean()).toBe(true);
        },
      },
      {
        field: {
          type: 'attachment',
          id: `fld${'h'.repeat(16)}`,
          name: 'Files',
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.name().toString() === 'Files');
          expect(field?.type().toString()).toBe('attachment');
        },
      },
      {
        field: {
          type: 'date',
          id: `fld${'i'.repeat(16)}`,
          name: 'Due',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.name().toString() === 'Due');
          expect(field?.type().toString()).toBe('date');
          if (!field) return;
          const typed = field as DateField;
          expect(typed.formatting().toDto()).toEqual({
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'utc',
          });
          expect(typed.defaultValue()?.toString()).toBe('now');
        },
      },
      {
        field: {
          type: 'user',
          id: `fld${'j'.repeat(16)}`,
          name: 'Owner',
          options: {
            isMultiple: true,
            shouldNotify: false,
            defaultValue: ['usr1', 'usr2'],
          },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.name().toString() === 'Owner');
          expect(field?.type().toString()).toBe('user');
          if (!field) return;
          const typed = field as UserField;
          expect(typed.multiplicity().toBoolean()).toBe(true);
          expect(typed.notification().toBoolean()).toBe(false);
          expect(typed.defaultValue()?.toDto()).toEqual(['usr1', 'usr2']);
        },
      },
      {
        field: {
          type: 'button',
          id: `fld${'k'.repeat(16)}`,
          name: 'Action',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 9,
            resetCount: true,
            workflow: { id: 'wfl123', name: 'Flow', isActive: true },
          },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.name().toString() === 'Action');
          expect(field?.type().toString()).toBe('button');
          if (!field) return;
          const typed = field as ButtonField;
          expect(typed.label().toString()).toBe('Run');
          expect(typed.color().toString()).toBe('teal');
          expect(typed.maxCount()?.toNumber()).toBe(9);
          expect(typed.resetCount()?.toBoolean()).toBe(true);
          expect(typed.workflow()?.toDto()).toEqual({
            id: 'wfl123',
            name: 'Flow',
            isActive: true,
          });
        },
      },
      {
        field: {
          type: 'formula',
          id: formulaFieldId,
          name: 'Score',
          options: {
            expression: `{${numberFieldId}} * 2`,
            timeZone: 'utc',
            formatting: { type: 'decimal', precision: 1 },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
          },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.id().toString() === formulaFieldId);
          expect(field?.type().toString()).toBe('formula');
          if (!field) return;
          const typed = field as FormulaField;
          expect(typed.expression().toString()).toBe(`{${numberFieldId}} * 2`);
          expect(typed.timeZone()?.toString()).toBe('utc');
          expect(typed.formatting()?.toDto()).toEqual({ type: 'decimal', precision: 1 });
          expect(typed.showAs()?.toDto()).toEqual({
            type: 'bar',
            color: 'red',
            showValue: true,
            maxValue: 100,
          });

          const valueTypeVisitor = new FieldValueTypeVisitor();
          const typeResult = typed.accept(valueTypeVisitor);
          expect(typeResult.isOk()).toBe(true);
          if (typeResult.isErr()) return;
          expect(typeResult.value.cellValueType.toString()).toBe('number');
          expect(typeResult.value.isMultipleCellValue.toBoolean()).toBe(false);

          expect(typed.dependencies().map((id) => id.toString())).toEqual([numberFieldId]);
        },
      },
      {
        field: {
          type: 'link',
          id: linkFieldId,
          name: 'Related',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id().toString(),
            lookupFieldId: foreignTable.primaryFieldId().toString(),
            symmetricFieldId: symmetricLinkFieldId,
          },
        },
        assert: (table: CreateFieldResult['table']) => {
          const field = table.fields().find((f) => f.id().toString() === linkFieldId);
          expect(field?.type().toString()).toBe('link');
        },
      },
    ];

    let currentTable = createdTable.value.table;
    for (const entry of cases) {
      const commandResult = CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId,
        field: entry.field,
      });
      expect(commandResult.isOk()).toBe(true);
      if (commandResult.isErr()) return;

      const result = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        context,
        commandResult.value
      );
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      currentTable = result.value.table;
      entry.assert(currentTable);
    }

    const foreignSpecResult = Table.specs(baseId).byId(foreignTable.id()).build();
    expect(foreignSpecResult.isOk()).toBe(true);
    if (foreignSpecResult.isErr()) return;

    const foreignResult = await tableRepository.findOne(context, foreignSpecResult.value);
    expect(foreignResult.isOk()).toBe(true);
    if (foreignResult.isErr()) return;
    const foreignLatest = foreignResult.value;
    const symmetricField = foreignLatest
      .fields()
      .find((f) => f.id().toString() === symmetricLinkFieldId);
    expect(symmetricField?.type().toString()).toBe('link');
  });
});
