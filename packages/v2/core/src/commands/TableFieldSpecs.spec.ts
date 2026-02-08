import { describe, expect, it } from 'vitest';

import { tableI18nKeys } from '@teable/i18n-keys';
import { BaseId } from '../domain/base/BaseId';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import { TableId } from '../domain/table/TableId';
import type { IExecutionContext } from '../ports/ExecutionContext';
import {
  collectForeignTableReferences,
  parseTableFieldSpec,
  resolveTableFieldInputName,
  resolveTableFieldInputs,
} from './TableFieldSpecs';

type FieldInput = Parameters<typeof resolveTableFieldInputs>[0][number];

const parseSpec = (field: FieldInput) => {
  return resolveTableFieldInputs([field], []).andThen((resolved) =>
    parseTableFieldSpec(resolved[0]!, { isPrimary: false })
  );
};

describe('TableFieldSpecs', () => {
  it('generates unique default names', () => {
    const resolved = resolveTableFieldInputName({ type: 'number' }, ['Number'])._unsafeUnwrap();
    expect(resolved.name).toBe('Number 2');
  });

  it('uses $t for default names when provided', () => {
    const t: NonNullable<IExecutionContext['$t']> = (key, options) =>
      options ? `${key}:${JSON.stringify(options)}` : key;

    const selectName = resolveTableFieldInputName({ type: 'singleSelect' }, [], {
      t,
    })._unsafeUnwrap().name;
    expect(selectName).toBe(tableI18nKeys.field.default.singleSelect.title);

    const autoNumberName = resolveTableFieldInputName({ type: 'autoNumber' }, [], {
      t,
    })._unsafeUnwrap().name;
    expect(autoNumberName).toBe(tableI18nKeys.field.default.autoNumber.title);
  });

  it('uses $t and foreign table data for derived default names when available', () => {
    const t: NonNullable<IExecutionContext['$t']> = (key, options) =>
      options ? `${key}:${JSON.stringify(options)}` : key;

    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const hostTableId = TableId.create(`tbl${'h'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();

    const foreignTable = (() => {
      const builder = Table.builder()
        .withBaseId(baseId)
        .withId(foreignTableId)
        .withName(TableName.create('Projects')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withId(lookupFieldId)
        .withName(FieldName.create('Project Name')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();
      return builder.build()._unsafeUnwrap();
    })();

    const hostTable = (() => {
      const builder = Table.builder()
        .withBaseId(baseId)
        .withId(hostTableId)
        .withName(TableName.create('Host')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withId(linkFieldId)
        .withName(FieldName.create('My Link')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();
      return builder.build()._unsafeUnwrap();
    })();

    const lookupName = resolveTableFieldInputName(
      {
        type: 'lookup',
        options: {
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          linkFieldId: linkFieldId.toString(),
        },
      },
      [],
      { t, hostTable, foreignTables: [foreignTable] }
    )._unsafeUnwrap().name;
    expect(lookupName).toBe(
      `${tableI18nKeys.field.default.lookup.title}:${JSON.stringify({
        lookupFieldName: 'Project Name',
        linkFieldName: 'My Link',
      })}`
    );

    const rollupName = resolveTableFieldInputName(
      {
        type: 'rollup',
        options: { expression: 'count({values})' },
        config: {
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          linkFieldId: linkFieldId.toString(),
        },
        cellValueType: 'number',
        isMultipleCellValue: false,
      },
      [],
      { t, hostTable, foreignTables: [foreignTable] }
    )._unsafeUnwrap().name;
    expect(rollupName).toBe(
      `${tableI18nKeys.field.default.rollup.title}:${JSON.stringify({
        lookupFieldName: 'Project Name',
        linkFieldName: 'My Link',
      })}`
    );

    const conditionalLookupName = resolveTableFieldInputName(
      {
        type: 'conditionalLookup',
        options: {
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          condition: { filter: { conjunction: 'and', filterSet: [] } },
        },
      },
      [],
      { t, hostTable, foreignTables: [foreignTable] }
    )._unsafeUnwrap().name;
    expect(conditionalLookupName).toBe(
      `${tableI18nKeys.field.default.conditionalLookup.title}:${JSON.stringify({
        lookupFieldName: 'Project Name',
        tableName: 'Projects',
      })}`
    );

    const conditionalRollupName = resolveTableFieldInputName(
      {
        type: 'conditionalRollup',
        options: { expression: 'sum({values})' },
        config: {
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
          condition: { filter: { conjunction: 'and', filterSet: [] } },
        },
        cellValueType: 'number',
        isMultipleCellValue: false,
      },
      [],
      { t, hostTable, foreignTables: [foreignTable] }
    )._unsafeUnwrap().name;
    expect(conditionalRollupName).toBe(
      `${tableI18nKeys.field.default.conditionalRollup.title}:${JSON.stringify({
        lookupFieldName: 'Project Name',
        tableName: 'Projects',
      })}`
    );

    const linkName = resolveTableFieldInputName(
      {
        type: 'link',
        options: {
          relationship: 'oneMany',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: lookupFieldId.toString(),
        },
      },
      [],
      { t, hostTable, foreignTables: [foreignTable] }
    )._unsafeUnwrap().name;
    expect(linkName).toBe('Projects');
  });

  it('parses field specs across types', () => {
    const primaryFieldId = `fld${'a'.repeat(16)}`;
    const foreignTableId = `tbl${'b'.repeat(16)}`;

    const cases: FieldInput[] = [
      { type: 'singleLineText', name: 'Text' },
      { type: 'longText', name: 'Notes' },
      { type: 'number', name: 'Amount' },
      { type: 'rating', name: 'Rating' },
      { type: 'formula', name: 'Calc', options: { expression: '1+1' } },
      {
        type: 'rollup',
        name: 'Rollup',
        options: { expression: 'count({values})' },
        config: {
          linkFieldId: primaryFieldId,
          foreignTableId,
          lookupFieldId: primaryFieldId,
        },
        cellValueType: 'number',
        isMultipleCellValue: false,
      },
      { type: 'singleSelect', name: 'Status', options: ['Todo', 'Done'] },
      { type: 'multipleSelect', name: 'Tags', options: ['A', 'B'] },
      { type: 'checkbox', name: 'Flag' },
      { type: 'attachment', name: 'Files' },
      { type: 'date', name: 'Date' },
      { type: 'createdTime', name: 'Created' },
      { type: 'lastModifiedTime', name: 'Updated' },
      { type: 'user', name: 'Owner', options: { isMultiple: true } },
      { type: 'createdBy', name: 'Creator' },
      { type: 'lastModifiedBy', name: 'Editor' },
      { type: 'autoNumber', name: 'Auto' },
      { type: 'button', name: 'Action', options: { label: 'Run' } },
      {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'oneMany',
          foreignTableId,
          lookupFieldId: primaryFieldId,
        },
      },
      {
        type: 'lookup',
        name: 'Lookup',
        options: {
          linkFieldId: primaryFieldId,
          foreignTableId,
          lookupFieldId: primaryFieldId,
        },
      },
      {
        type: 'conditionalLookup',
        name: 'Conditional Lookup',
        options: {
          foreignTableId,
          lookupFieldId: primaryFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: primaryFieldId, operator: 'is', value: 'x' }],
            },
          },
        },
      },
      {
        type: 'conditionalRollup',
        name: 'Conditional Rollup',
        options: { expression: 'sum({values})' },
        config: {
          foreignTableId,
          lookupFieldId: primaryFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: primaryFieldId, operator: 'is', value: 'x' }],
            },
          },
        },
        cellValueType: 'number',
        isMultipleCellValue: false,
      },
    ];

    for (const input of cases) {
      const specResult = parseSpec(input);
      if (specResult.isErr()) {
        throw new Error(`Failed to parse field type ${input.type}: ${specResult.error.message}`);
      }
      const spec = specResult.value;
      const builder = Table.builder()
        .withBaseId(BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap())
        .withName(TableName.create('Spec')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();
      spec.applyTo(builder);
      expect(builder.build().isOk()).toBe(true);
    }
  });

  it('collects foreign table references from specs', () => {
    const linkSpec = parseSpec({
      type: 'link',
      name: 'Link',
      options: {
        relationship: 'oneMany',
        foreignTableId: `tbl${'d'.repeat(16)}`,
        lookupFieldId: `fld${'e'.repeat(16)}`,
      },
    })._unsafeUnwrap();
    const lookupSpec = parseSpec({
      type: 'lookup',
      name: 'Lookup',
      options: {
        linkFieldId: `fld${'f'.repeat(16)}`,
        foreignTableId: `tbl${'d'.repeat(16)}`,
        lookupFieldId: `fld${'e'.repeat(16)}`,
      },
    })._unsafeUnwrap();

    const references = collectForeignTableReferences([linkSpec, lookupSpec])._unsafeUnwrap();
    expect(references).toHaveLength(1);
    expect(references[0]?.foreignTableId.toString()).toBe(`tbl${'d'.repeat(16)}`);
  });

  it('creates new field ids when missing', () => {
    const spec = parseSpec({ type: 'singleLineText', name: 'New Field' })._unsafeUnwrap();
    const field = spec.createField()._unsafeUnwrap();
    expect(field.id()).toBeInstanceOf(FieldId);
  });
});
