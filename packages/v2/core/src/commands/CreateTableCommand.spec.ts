import { describe, expect, it } from 'vitest';

import { tableI18nKeys } from '@teable/i18n-keys';
import { BaseId } from '../domain/base/BaseId';
import { Field } from '../domain/table/fields/Field';
import type { LinkField } from '../domain/table/fields/types/LinkField';
import type { NumberField } from '../domain/table/fields/types/NumberField';
import type { RollupField } from '../domain/table/fields/types/RollupField';
import type { SingleSelectField } from '../domain/table/fields/types/SingleSelectField';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { CreateTableCommand } from './CreateTableCommand';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const buildFieldSpec = (
  build: (builder: ReturnType<typeof Field.specs>) => ReturnType<typeof Field.specs>
) => build(Field.specs()).build()._unsafeUnwrap();

const buildFromCommand = (command: CreateTableCommand) => {
  const builder = Table.builder().withBaseId(command.baseId).withName(command.tableName);
  if (command.tableId) {
    builder.withId(command.tableId);
  }
  for (const fieldSpec of command.fields) fieldSpec.applyTo(builder);
  for (const viewSpec of command.views) viewSpec.applyTo(builder);
  return builder.build();
};

describe('CreateTableCommand', () => {
  it('creates command with default field and view', () => {
    const baseId = createBaseId('a')._unsafeUnwrap();
    const command = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Default Table',
    })._unsafeUnwrap();
    const table = buildFromCommand(command)._unsafeUnwrap();
    expect(table.getFields().length).toBe(1);
    expect(table.getFields()[0]?.type().toString()).toBe('singleLineText');
    expect(table.getFields()[0]?.name().toString()).toBe('Name');
    expect(table.views().length).toBe(1);
    expect(table.views()[0]?.type().toString()).toBe('grid');
    expect(table.views()[0]?.name().toString()).toBe('Grid');
  });

  it('creates command with translated default field when $t is provided', () => {
    const baseId = createBaseId('t')._unsafeUnwrap();
    const t: NonNullable<IExecutionContext['$t']> = (key) => key;
    const command = CreateTableCommand.create(
      {
        baseId: baseId.toString(),
        name: 'Default Table',
      },
      { t }
    )._unsafeUnwrap();
    const table = buildFromCommand(command)._unsafeUnwrap();
    expect(table.getFields().length).toBe(1);
    expect(table.getFields()[0]?.type().toString()).toBe('singleLineText');
    expect(table.getFields()[0]?.name().toString()).toBe(
      tableI18nKeys.field.default.singleLineText.title
    );
  });

  it('parses record inputs', () => {
    const baseId = createBaseId('r')._unsafeUnwrap();
    const fieldId = `fld${'t'.repeat(16)}`;
    const command = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Record Table',
      fields: [{ type: 'singleLineText', id: fieldId, name: 'Name', isPrimary: true }],
      records: [{ fields: { [fieldId]: 'Alpha' } }],
    })._unsafeUnwrap();

    expect(command.records).toHaveLength(1);
    expect(command.records[0]?.fieldValues.get(fieldId)).toBe('Alpha');
  });

  it('creates command with all field types and view types', () => {
    const baseId = createBaseId('b')._unsafeUnwrap();

    const amountFieldId = 'fldaaaaaaaaaaaaaaaa';
    const formulaFieldId = 'fldbbbbbbbbbbbbbbbb';

    const command = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Complex Table',
      fields: [
        {
          type: 'singleLineText',
          name: 'Title',
          options: { showAs: { type: 'url' }, defaultValue: 'https://example.com' },
          isPrimary: true,
        },
        {
          type: 'longText',
          name: 'Notes',
          options: { defaultValue: 'note' },
        },
        {
          type: 'number',
          id: amountFieldId,
          name: 'Amount',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
            defaultValue: 42,
          },
        },
        {
          type: 'autoNumber',
          name: 'Auto Number',
        },
        {
          type: 'rating',
          name: 'Score',
          options: { max: 5, icon: 'star', color: 'redBright' },
        },
        {
          type: 'singleSelect',
          name: 'Status',
          options: ['Todo', 'Done'],
        },
        {
          type: 'multipleSelect',
          name: 'Tags',
          options: {
            choices: [
              { id: 'opt1', name: 'A', color: 'blue' },
              { id: 'opt2', name: 'B', color: 'red' },
            ],
            defaultValue: ['A'],
            preventAutoNewOptions: true,
          },
        },
        {
          type: 'checkbox',
          name: 'Done',
          options: { defaultValue: true },
        },
        {
          type: 'attachment',
          name: 'Files',
        },
        {
          type: 'date',
          name: 'Due',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
        },
        {
          type: 'createdTime',
          name: 'Created Time',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
        },
        {
          type: 'lastModifiedTime',
          name: 'Last Modified Time',
        },
        {
          type: 'user',
          name: 'Owner',
          options: { isMultiple: true, shouldNotify: true, defaultValue: ['usr123'] },
        },
        {
          type: 'createdBy',
          name: 'Created By',
        },
        {
          type: 'lastModifiedBy',
          name: 'Last Modified By',
        },
        {
          type: 'button',
          name: 'Action',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 2,
            resetCount: true,
            workflow: { id: 'wfl123', name: 'Flow', isActive: true },
          },
        },
        {
          type: 'formula',
          id: formulaFieldId,
          name: 'Total',
          options: {
            expression: `{${amountFieldId}} + 1`,
            formatting: { type: 'decimal', precision: 2 },
          },
        },
      ],
      views: [
        { type: 'grid', name: 'Main' },
        { type: 'kanban' },
        { type: 'calendar' },
        { type: 'gallery' },
        { type: 'form' },
        { type: 'plugin' },
      ],
    })._unsafeUnwrap();
    const table = buildFromCommand(command)._unsafeUnwrap();
    expect(table.getFields().map((field) => field.type().toString())).toEqual([
      'singleLineText',
      'longText',
      'number',
      'autoNumber',
      'rating',
      'singleSelect',
      'multipleSelect',
      'checkbox',
      'attachment',
      'date',
      'createdTime',
      'lastModifiedTime',
      'user',
      'createdBy',
      'lastModifiedBy',
      'button',
      'formula',
    ]);
    expect(table.views().map((view) => view.type().toString())).toEqual([
      'grid',
      'kanban',
      'calendar',
      'gallery',
      'form',
      'plugin',
    ]);

    const numberField = table.getFields(buildFieldSpec((builder) => builder.isNumber()))[0] as
      | NumberField
      | undefined;
    expect(numberField?.formatting().type()).toBe('currency');
    expect(numberField?.showAs()).toBeDefined();

    const selectField = table.getFields(
      buildFieldSpec((builder) => builder.isSingleSelect())
    )[0] as SingleSelectField | undefined;
    expect(selectField?.preventAutoNewOptions().toBoolean()).toBe(false);

    const firstView = table.views()[0];
    expect(firstView?.name().toString()).toBe('Main');
  });

  it('creates command with rollup field input', () => {
    const baseId = createBaseId('r')._unsafeUnwrap();

    const linkFieldId = `fld${'l'.repeat(16)}`;
    const foreignTableId = `tbl${'f'.repeat(16)}`;
    const lookupFieldId = `fld${'k'.repeat(16)}`;

    const command = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Rollup Table',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId,
            lookupFieldId,
          },
        },
        {
          type: 'rollup',
          name: 'Rollup Total',
          options: {
            expression: 'counta({values})',
            formatting: { type: 'decimal', precision: 2 },
          },
          config: {
            linkFieldId,
            foreignTableId,
            lookupFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();
    const table = buildFromCommand(command)._unsafeUnwrap();
    const rollupField = table.getFields(buildFieldSpec((builder) => builder.isRollup()))[0] as
      | RollupField
      | undefined;
    expect(rollupField).toBeDefined();
    if (!rollupField) return;
    expect(rollupField.expression().toString()).toBe('counta({values})');
    expect(rollupField.configDto()).toEqual({
      linkFieldId,
      foreignTableId,
      lookupFieldId,
    });
  });

  describe('link fields', () => {
    it('builds link fields from input', () => {
      const baseId = createBaseId('d')._unsafeUnwrap();

      const foreignTableId = `tbl${'c'.repeat(16)}`;
      const lookupFieldId = `fld${'d'.repeat(16)}`;
      const linkFieldId = `fld${'e'.repeat(16)}`;

      const command = CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Link Table',
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
      })._unsafeUnwrap();
      const table = buildFromCommand(command)._unsafeUnwrap();
      const linkField = table.getFields(buildFieldSpec((builder) => builder.isLink()))[0] as
        | LinkField
        | undefined;
      expect(linkField).toBeDefined();
      if (!linkField) return;
      expect(linkField.id().toString()).toBe(linkFieldId);
      expect(linkField.relationship().toString()).toBe('manyOne');
      expect(linkField.foreignTableId().toString()).toBe(foreignTableId);
      expect(linkField.lookupFieldId().toString()).toBe(lookupFieldId);
      expect(linkField.hasOrderColumn()).toBe(true);
    });

    it('supports all relationships including self references', () => {
      const baseId = createBaseId('x')._unsafeUnwrap();
      const tableId = createTableId('y')._unsafeUnwrap();

      const tableIdValue = tableId.toString();
      const lookupFieldId = `fld${'z'.repeat(16)}`;
      const relationshipCases = ['oneOne', 'manyMany', 'oneMany', 'manyOne'] as const;

      const command = CreateTableCommand.create({
        baseId: baseId.toString(),
        tableId: tableIdValue,
        name: 'Self Link Table',
        fields: [
          { type: 'singleLineText', name: 'Name', id: lookupFieldId, isPrimary: true },
          ...relationshipCases.map((relationship, index) => ({
            type: 'link' as const,
            id: `fld${String(index).repeat(16)}`,
            name: `Link ${relationship}`,
            options: {
              relationship,
              foreignTableId: tableIdValue,
              lookupFieldId,
            },
          })),
        ],
        views: [{ type: 'grid' }],
      })._unsafeUnwrap();
      const table = buildFromCommand(command)._unsafeUnwrap();
      const linkFields = table.getFields(buildFieldSpec((builder) => builder.isLink())) as
        | LinkField[]
        | undefined;
      expect(linkFields?.length).toBe(4);
      if (!linkFields) return;

      const relationships = linkFields.map((field) => field.relationship().toString());
      expect(relationships.sort()).toEqual([...relationshipCases].sort());
      expect(linkFields.every((field) => field.foreignTableId().toString() === tableIdValue)).toBe(
        true
      );
    });
  });

  describe('rehydrated-only fields', () => {
    it('rejects link meta in input', () => {
      const baseId = createBaseId('e')._unsafeUnwrap();

      const error = CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Link Meta',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'Company',
            options: {
              relationship: 'manyOne',
              foreignTableId: `tbl${'c'.repeat(16)}`,
              lookupFieldId: `fld${'d'.repeat(16)}`,
            },
            meta: { hasOrderColumn: true },
          },
        ],
      })._unsafeUnwrapErr();
      expect(error).toBeTruthy();
    });

    it('rejects formula result type in input', () => {
      const baseId = createBaseId('f')._unsafeUnwrap();

      const error = CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Formula Result Type',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'formula',
            name: 'Total',
            options: { expression: '1 + 1' },
            cellValueType: 'number',
            isMultipleCellValue: false,
          },
        ],
      })._unsafeUnwrapErr();
      expect(error).toBeTruthy();
    });
  });
});
