/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  CreateFieldCommand,
  CreateTableCommand,
  type CreateFieldResult,
  type CreateTableResult,
  FieldId,
  FieldName,
  FieldSpecBuilder,
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
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { getV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

const buildFieldSpec = (build: (builder: FieldSpecBuilder) => FieldSpecBuilder) =>
  build(FieldSpecBuilder.create()).build()._unsafeUnwrap();

const getFieldByName = (table: CreateFieldResult['table'], name: string) => {
  const nameResult = FieldName.create(name);
  nameResult._unsafeUnwrap();
  return table.getFields(
    buildFieldSpec((builder) => builder.withFieldName(nameResult._unsafeUnwrap()))
  )[0];
};

const getFieldById = (table: CreateFieldResult['table'], id: string) => {
  const idResult = FieldId.create(id);
  idResult._unsafeUnwrap();
  return table.getFields(
    buildFieldSpec((builder) => builder.withFieldId(idResult._unsafeUnwrap()))
  )[0];
};

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
    createTableResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const createdTable = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableResult._unsafeUnwrap()
    );
    createdTable._unsafeUnwrap();

    const createForeignResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Foreign',
      fields: [{ type: 'singleLineText', name: 'Title' }],
    });
    createForeignResult._unsafeUnwrap();

    const foreignCreated = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createForeignResult._unsafeUnwrap()
    );
    const foreignCreatedValue = foreignCreated._unsafeUnwrap();
    const createdTableValue = createdTable._unsafeUnwrap();

    const foreignTable = foreignCreatedValue.table;

    const tableId = createdTableValue.table.id().toString();
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
          const field = getFieldByName(table, 'Title');
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
          const field = getFieldByName(table, 'Notes');
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
          const field = getFieldById(table, numberFieldId);
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
          const field = getFieldByName(table, 'Priority');
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
          const field = getFieldByName(table, 'Status');
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
          const field = getFieldByName(table, 'Tags');
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
          const field = getFieldByName(table, 'Approved');
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
          const field = getFieldByName(table, 'Files');
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
          const field = getFieldByName(table, 'Due');
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
          const field = getFieldByName(table, 'Owner');
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
          const field = getFieldByName(table, 'Action');
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
          const field = getFieldById(table, formulaFieldId);
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
          typeResult._unsafeUnwrap();

          expect(typeResult._unsafeUnwrap().cellValueType.toString()).toBe('number');
          expect(typeResult._unsafeUnwrap().isMultipleCellValue.toBoolean()).toBe(false);

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
          const field = getFieldById(table, linkFieldId);
          expect(field?.type().toString()).toBe('link');
        },
      },
    ];

    let currentTable = createdTableValue.table;
    for (const entry of cases) {
      const commandResult = CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId,
        field: entry.field,
      });
      commandResult._unsafeUnwrap();

      const result = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        context,
        commandResult._unsafeUnwrap()
      );
      const resultValue = result._unsafeUnwrap();
      currentTable = resultValue.table;
      entry.assert(currentTable);
    }

    const foreignSpecResult = foreignTable.specs().byId(foreignTable.id()).build();
    foreignSpecResult._unsafeUnwrap();

    const foreignResult = await tableRepository.findOne(context, foreignSpecResult._unsafeUnwrap());
    foreignResult._unsafeUnwrap();

    const foreignLatest = foreignResult._unsafeUnwrap();
    const symmetricField = getFieldById(foreignLatest, symmetricLinkFieldId);
    expect(symmetricField?.type().toString()).toBe('link');
  });
});
