import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { AttachmentField } from '../domain/table/fields/types/AttachmentField';
import { AutoNumberField } from '../domain/table/fields/types/AutoNumberField';
import { ButtonField } from '../domain/table/fields/types/ButtonField';
import { CheckboxField } from '../domain/table/fields/types/CheckboxField';
import { CreatedByField } from '../domain/table/fields/types/CreatedByField';
import { CreatedTimeField } from '../domain/table/fields/types/CreatedTimeField';
import { DateField } from '../domain/table/fields/types/DateField';
import { FormulaField } from '../domain/table/fields/types/FormulaField';
import { LastModifiedByField } from '../domain/table/fields/types/LastModifiedByField';
import { LastModifiedTimeField } from '../domain/table/fields/types/LastModifiedTimeField';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { LongTextField } from '../domain/table/fields/types/LongTextField';
import { MultipleSelectField } from '../domain/table/fields/types/MultipleSelectField';
import { NumberField } from '../domain/table/fields/types/NumberField';
import { RatingField } from '../domain/table/fields/types/RatingField';
import { RollupField } from '../domain/table/fields/types/RollupField';
import { SingleLineTextField } from '../domain/table/fields/types/SingleLineTextField';
import { SingleSelectField } from '../domain/table/fields/types/SingleSelectField';
import { UserField } from '../domain/table/fields/types/UserField';
import { TableId } from '../domain/table/TableId';
import type { ITableFieldInput } from '../schemas/field';
import { CreateFieldCommand } from './CreateFieldCommand';
import { parseTableFieldSpec, resolveTableFieldInputName } from './TableFieldSpecs';

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

    commandResult._unsafeUnwrap();

    const command = commandResult._unsafeUnwrap();
    expect(command.baseId.toString()).toBe(baseId);
    expect(command.tableId.toString()).toBe(tableId);
    expect(command.field.name).toBe('Title');
    expect(command.field.type).toBe('singleLineText');
  });

  it('accepts field input without name', () => {
    const commandResult = CreateFieldCommand.create({
      baseId,
      tableId,
      field: {
        type: 'singleLineText',
      },
    });

    commandResult._unsafeUnwrap();
  });

  it('generates a default name when input name is blank', () => {
    const resolved = resolveTableFieldInputName(
      { type: 'singleLineText', name: '   ' },
      []
    )._unsafeUnwrap();

    expect(resolved.name).toBe('Label');
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

    commandResult._unsafeUnwrapErr();
  });

  it('parses all field types with configured options', () => {
    const cases = [
      {
        field: {
          type: 'singleLineText',
          name: 'Title',
          options: { showAs: { type: 'email' }, defaultValue: 'Hello' },
          notNull: true,
          unique: true,
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(SingleLineTextField);
          const typed = field as SingleLineTextField;
          expect(typed.showAs()?.toDto()).toEqual({ type: 'email' });
          expect(typed.defaultValue()?.toString()).toBe('Hello');
          expect(typed.notNull().toBoolean()).toBe(true);
          expect(typed.unique().toBoolean()).toBe(true);
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
          type: 'autoNumber',
          name: 'Auto Number',
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(AutoNumberField);
          const typed = field as AutoNumberField;
          expect(typed.expression().toString()).toBe('AUTO_NUMBER()');
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
          type: 'createdTime',
          name: 'Created Time',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(CreatedTimeField);
          const typed = field as CreatedTimeField;
          expect(typed.formatting().toDto()).toEqual({
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'utc',
          });
          expect(typed.expression().toString()).toBe('CREATED_TIME()');
        },
      },
      {
        field: {
          type: 'lastModifiedTime',
          name: 'Last Modified Time',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            trackedFieldIds: [`fld${'t'.repeat(16)}`],
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(LastModifiedTimeField);
          const typed = field as LastModifiedTimeField;
          expect(typed.formatting().toDto()).toEqual({
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'utc',
          });
          expect(typed.trackedFieldIds().length).toBe(1);
          expect(typed.expression().toString()).toBe('LAST_MODIFIED_TIME()');
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
          type: 'createdBy',
          name: 'Created By',
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(CreatedByField);
        },
      },
      {
        field: {
          type: 'lastModifiedBy',
          name: 'Last Modified By',
          options: {
            trackedFieldIds: [`fld${'m'.repeat(16)}`],
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(LastModifiedByField);
          const typed = field as LastModifiedByField;
          expect(typed.trackedFieldIds().length).toBe(1);
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
          type: 'rollup',
          name: 'Rollup Total',
          options: {
            expression: 'counta({values})',
            timeZone: 'utc',
            formatting: { type: 'decimal', precision: 2 },
            showAs: { type: 'bar', color: 'blue', showValue: true, maxValue: 10 },
          },
          config: {
            linkFieldId: `fld${'c'.repeat(16)}`,
            foreignTableId: `tbl${'d'.repeat(16)}`,
            lookupFieldId: `fld${'e'.repeat(16)}`,
          },
        },
        assert: (field: unknown) => {
          expect(field).toBeInstanceOf(RollupField);
          const typed = field as RollupField;
          expect(typed.expression().toString()).toBe('counta({values})');
          expect(typed.timeZone()?.toString()).toBe('utc');
          expect(typed.configDto()).toEqual({
            linkFieldId: `fld${'c'.repeat(16)}`,
            foreignTableId: `tbl${'d'.repeat(16)}`,
            lookupFieldId: `fld${'e'.repeat(16)}`,
          });
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
    ] satisfies ReadonlyArray<{ field: ITableFieldInput; assert: (field: unknown) => void }>;

    const baseIdValue = BaseId.create(baseId)._unsafeUnwrap();
    const tableIdValue = TableId.create(tableId)._unsafeUnwrap();

    for (const entry of cases) {
      const commandResult = CreateFieldCommand.create({
        baseId,
        tableId,
        field: entry.field,
      });
      commandResult._unsafeUnwrap();

      const resolvedInput = resolveTableFieldInputName(entry.field, [])._unsafeUnwrap();
      const spec = parseTableFieldSpec(resolvedInput, { isPrimary: false })._unsafeUnwrap();
      const field = spec
        .createField({ baseId: baseIdValue, tableId: tableIdValue })
        ._unsafeUnwrap();
      entry.assert(field);
    }
  });

  it('rejects notNull/unique for computed fields', () => {
    const notNullInput = resolveTableFieldInputName(
      {
        type: 'formula',
        name: 'Score',
        options: { expression: '1' },
        notNull: true,
      },
      []
    )._unsafeUnwrap();

    const notNullResult = parseTableFieldSpec(notNullInput, { isPrimary: false });
    expect(notNullResult.isErr()).toBe(true);
    expect(notNullResult._unsafeUnwrapErr().message).toContain('notNull');

    const uniqueInput = resolveTableFieldInputName(
      {
        type: 'formula',
        name: 'Score Unique',
        options: { expression: '2' },
        unique: true,
      },
      []
    )._unsafeUnwrap();

    const uniqueResult = parseTableFieldSpec(uniqueInput, { isPrimary: false });
    expect(uniqueResult.isErr()).toBe(true);
    expect(uniqueResult._unsafeUnwrapErr().message).toContain('unique');
  });
});
