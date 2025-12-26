import { describe, expect, it } from 'vitest';

import { AttachmentField } from '../domain/table/fields/types/AttachmentField';
import { ButtonField } from '../domain/table/fields/types/ButtonField';
import { CheckboxField } from '../domain/table/fields/types/CheckboxField';
import { DateField } from '../domain/table/fields/types/DateField';
import { FormulaField } from '../domain/table/fields/types/FormulaField';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { LongTextField } from '../domain/table/fields/types/LongTextField';
import { MultipleSelectField } from '../domain/table/fields/types/MultipleSelectField';
import { NumberField } from '../domain/table/fields/types/NumberField';
import { RatingField } from '../domain/table/fields/types/RatingField';
import { SingleLineTextField } from '../domain/table/fields/types/SingleLineTextField';
import { SingleSelectField } from '../domain/table/fields/types/SingleSelectField';
import { UserField } from '../domain/table/fields/types/UserField';
import { CreateFieldCommand } from './CreateFieldCommand';

const baseId = `bse${'a'.repeat(16)}`;
const tableId = `tbl${'b'.repeat(16)}`;

describe('CreateFieldCommand', () => {
  it('creates command with a field payload', () => {
    const commandResult = CreateFieldCommand.create({
      baseId,
      tableId,
      field: {
        type: 'singleLineText',
        name: 'Title',
        options: { defaultValue: 'Hello' },
      },
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const command = commandResult.value;
    expect(command.baseId.toString()).toBe(baseId);
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.field.name().toString()).toBe('Title');
    expect(command.field.type().toString()).toBe('singleLineText');
  });

  it('rejects primary field updates', () => {
    const commandResult = CreateFieldCommand.create({
      baseId,
      tableId,
      field: {
        type: 'singleLineText',
        name: 'Primary',
        isPrimary: true,
      },
    });

    expect(commandResult.isErr()).toBe(true);
  });

  it('parses all field types with configured options', () => {
    const cases = [
      {
        field: {
          type: 'singleLineText',
          name: 'Title',
          options: { showAs: { type: 'email' }, defaultValue: 'Hello' },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(SingleLineTextField);
          const typed = field as SingleLineTextField;
          expect(typed.showAs()?.toDto()).toEqual({ type: 'email' });
          expect(typed.defaultValue()?.toString()).toBe('Hello');
        },
      },
      {
        field: {
          type: 'longText',
          name: 'Notes',
          options: { defaultValue: 'Details' },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(LongTextField);
          const typed = field as LongTextField;
          expect(typed.defaultValue()?.toString()).toBe('Details');
        },
      },
      {
        field: {
          type: 'number',
          name: 'Amount',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
            defaultValue: 42,
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(NumberField);
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
          name: 'Priority',
          options: { max: 7, icon: 'star', color: 'yellowBright' },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(RatingField);
          const typed = field as RatingField;
          expect(typed.ratingMax().toNumber()).toBe(7);
          expect(typed.ratingIcon().toString()).toBe('star');
          expect(typed.ratingColor().toString()).toBe('yellowBright');
        },
      },
      {
        field: {
          type: 'singleSelect',
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
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(SingleSelectField);
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
          name: 'Tags',
          options: {
            choices: [
              { id: 'opt3', name: 'Alpha', color: 'purple' },
              { id: 'opt4', name: 'Beta', color: 'orange' },
            ],
            defaultValue: ['Alpha', 'Beta'],
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(MultipleSelectField);
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
          name: 'Approved',
          options: { defaultValue: true },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(CheckboxField);
          const typed = field as CheckboxField;
          expect(typed.defaultValue()?.toBoolean()).toBe(true);
        },
      },
      {
        field: {
          type: 'attachment',
          name: 'Files',
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(AttachmentField);
        },
      },
      {
        field: {
          type: 'date',
          name: 'Due',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(DateField);
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
          name: 'Owner',
          options: {
            isMultiple: true,
            shouldNotify: false,
            defaultValue: ['usr1', 'usr2'],
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(UserField);
          const typed = field as UserField;
          expect(typed.multiplicity().toBoolean()).toBe(true);
          expect(typed.notification().toBoolean()).toBe(false);
          expect(typed.defaultValue()?.toDto()).toEqual(['usr1', 'usr2']);
        },
      },
      {
        field: {
          type: 'button',
          name: 'Action',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 9,
            resetCount: true,
            workflow: { id: 'wfl123', name: 'Flow', isActive: true },
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(ButtonField);
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
          name: 'Score',
          options: {
            expression: '1 + 1',
            timeZone: 'utc',
            formatting: { type: 'decimal', precision: 1 },
            showAs: { type: 'url' },
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(FormulaField);
          const typed = field as FormulaField;
          expect(typed.expression().toString()).toBe('1 + 1');
          expect(typed.timeZone()?.toString()).toBe('utc');
          expect(typed.formatting()?.toDto()).toEqual({ type: 'decimal', precision: 1 });
          expect(typed.showAs()?.toDto()).toEqual({ type: 'url' });
        },
      },
      {
        field: {
          type: 'link',
          name: 'Self Link',
          options: {
            relationship: 'manyMany',
            foreignTableId: tableId,
            lookupFieldId: `fld${'c'.repeat(16)}`,
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(LinkField);
          const typed = field as LinkField;
          expect(typed.relationship().toString()).toBe('manyMany');
          expect(typed.foreignTableId().toString()).toBe(tableId);
        },
      },
      {
        field: {
          type: 'link',
          name: 'OneOne',
          options: {
            relationship: 'oneOne',
            foreignTableId: `tbl${'d'.repeat(16)}`,
            lookupFieldId: `fld${'e'.repeat(16)}`,
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(LinkField);
          const typed = field as LinkField;
          expect(typed.relationship().toString()).toBe('oneOne');
        },
      },
      {
        field: {
          type: 'link',
          name: 'OneMany',
          options: {
            relationship: 'oneMany',
            foreignTableId: `tbl${'f'.repeat(16)}`,
            lookupFieldId: `fld${'g'.repeat(16)}`,
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(LinkField);
          const typed = field as LinkField;
          expect(typed.relationship().toString()).toBe('oneMany');
        },
      },
      {
        field: {
          type: 'link',
          name: 'ManyOne',
          options: {
            relationship: 'manyOne',
            foreignTableId: `tbl${'h'.repeat(16)}`,
            lookupFieldId: `fld${'i'.repeat(16)}`,
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(LinkField);
          const typed = field as LinkField;
          expect(typed.relationship().toString()).toBe('manyOne');
        },
      },
    ];

    for (const entry of cases) {
      const result = CreateFieldCommand.create({
        baseId,
        tableId,
        field: entry.field,
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      entry.assert(result.value.field);
    }
  });
});
