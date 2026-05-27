import { describe, expect, it } from 'vitest';

import { buildTableFromInput } from '../../../core/src/commands/TableInputParser';
import { FormulaField } from '../../../core/src/domain/table/fields/types/FormulaField';
import type { ITableFieldInput } from '../../../core/src/schemas/field';
import { normalizeField } from './DotTeaFieldNormalizer';

describe('DotTeaFieldNormalizer', () => {
  it('deduplicates select choices that only differ by surrounding whitespace', () => {
    const normalized = normalizeField(
      {
        id: `fld${'s'.repeat(16)}`,
        type: 'singleSelect',
        name: 'T次',
        options: {
          choices: [
            { id: 'chom4XbfXuh', name: 'T1', color: 'purple' },
            { id: 'cho0eYy9LIM', name: ' T1', color: 'purpleLight2' },
            { id: 'chojvEzfz4d', name: 'T2', color: 'blueLight2' },
          ],
          defaultValue: ' T1',
        },
      },
      new Map()
    );

    expect(normalized.options).toEqual({
      choices: [
        { id: 'chom4XbfXuh', name: 'T1', color: 'purple' },
        { id: 'chojvEzfz4d', name: 'T2', color: 'blueLight2' },
      ],
      defaultValue: 'T1',
    });

    const normalizedFieldInput = {
      id: normalized.id,
      type: normalized.type,
      name: normalized.name,
      options: normalized.options,
    } as ITableFieldInput;

    const result = buildTableFromInput({
      baseId: `bse${'a'.repeat(16)}`,
      tableId: `tbl${'b'.repeat(16)}`,
      name: 'Import Test',
      fields: [
        {
          id: `fld${'p'.repeat(16)}`,
          type: 'singleLineText',
          name: 'Name',
          isPrimary: true,
        },
        normalizedFieldInput,
      ],
    });

    expect(result.isOk()).toBe(true);
  });

  it('downgrades formulas that reference missing fields to singleLineText', () => {
    const normalized = normalizeField(
      {
        id: `fld${'f'.repeat(16)}`,
        type: 'formula',
        name: 'Broken Formula',
        options: {
          expression: 'SUM({fldaaaaaaaaaaaaaaaa},{fldbbbbbbbbbbbbbbbb})',
        },
      },
      new Map([['fldaaaaaaaaaaaaaaaa', 'number']])
    );

    expect(normalized.type).toBe('singleLineText');
    expect(normalized.options).toEqual({
      expression: 'SUM({fldaaaaaaaaaaaaaaaa},{fldbbbbbbbbbbbbbbbb})',
    });
  });

  it('preserves formula result type exported by dottea', () => {
    const normalized = normalizeField(
      {
        id: `fld${'f'.repeat(16)}`,
        type: 'formula',
        name: 'Legacy Number Formula',
        cellValueType: 'number',
        options: {
          expression: '"legacy"',
          formatting: { type: 'decimal', precision: 2 },
        },
      },
      new Map()
    );

    expect(normalized).toMatchObject({
      type: 'formula',
      cellValueType: 'number',
      isMultipleCellValue: false,
    });

    const normalizedFieldInput = {
      id: normalized.id,
      type: normalized.type,
      name: normalized.name,
      options: normalized.options,
      cellValueType: normalized.cellValueType,
      isMultipleCellValue: normalized.isMultipleCellValue,
    } as ITableFieldInput;

    const result = buildTableFromInput({
      baseId: `bse${'a'.repeat(16)}`,
      tableId: `tbl${'b'.repeat(16)}`,
      name: 'Import Test',
      fields: [
        {
          id: `fld${'p'.repeat(16)}`,
          type: 'singleLineText',
          name: 'Name',
          isPrimary: true,
        },
        normalizedFieldInput,
      ],
    });

    expect(result.isOk()).toBe(true);
  });

  it('uses default formatting when legacy formula result type has no formatting', () => {
    const normalized = normalizeField(
      {
        id: `fld${'d'.repeat(16)}`,
        type: 'formula',
        name: 'Legacy Date Formula',
        cellValueType: 'dateTime',
        options: {
          expression: '"legacy"',
        },
      },
      new Map()
    );

    const normalizedFieldInput = {
      id: normalized.id,
      type: normalized.type,
      name: normalized.name,
      options: normalized.options,
      cellValueType: normalized.cellValueType,
      isMultipleCellValue: normalized.isMultipleCellValue,
    } as ITableFieldInput;

    const result = buildTableFromInput({
      baseId: `bse${'a'.repeat(16)}`,
      tableId: `tbl${'b'.repeat(16)}`,
      name: 'Import Test',
      fields: [
        {
          id: `fld${'p'.repeat(16)}`,
          type: 'singleLineText',
          name: 'Name',
          isPrimary: true,
        },
        normalizedFieldInput,
      ],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.message);
    const formulaField = result.value.table
      .getFields()
      .find((field) => field.id().toString() === normalized.id);
    expect(formulaField).toBeInstanceOf(FormulaField);
    expect((formulaField as FormulaField).formatting()?.toDto()).toEqual({
      date: 'YYYY-MM-DD',
      time: 'None',
      timeZone: expect.any(String),
    });
  });

  it('downgrades relation fields when the foreign table is not exported', () => {
    const normalized = normalizeField(
      {
        id: `fld${'r'.repeat(16)}`,
        type: 'rollup',
        name: 'Missing Foreign Rollup',
        cellValueType: 'number',
        lookupOptions: {
          foreignTableId: `tbl${'x'.repeat(16)}`,
          linkFieldId: `fld${'l'.repeat(16)}`,
          lookupFieldId: `fld${'v'.repeat(16)}`,
        },
        options: {
          expression: 'countall({values})',
          formatting: { type: 'decimal', precision: 0 },
        },
      },
      new Map(),
      { availableTableIds: new Set([`tbl${'b'.repeat(16)}`]) }
    );

    expect(normalized).toMatchObject({
      id: `fld${'r'.repeat(16)}`,
      type: 'singleLineText',
      name: 'Missing Foreign Rollup',
    });
  });

  it('downgrades relation fields when referenced fields are not exported', () => {
    const hostTableId = `tbl${'h'.repeat(16)}`;
    const foreignTableId = `tbl${'f'.repeat(16)}`;
    const linkFieldId = `fld${'l'.repeat(16)}`;
    const missingLookupFieldId = `fld${'m'.repeat(16)}`;
    const fieldIdsByTableId = new Map([
      [hostTableId, new Set([linkFieldId])],
      [foreignTableId, new Set([`fld${'v'.repeat(16)}`])],
    ]);

    const normalized = normalizeField(
      {
        id: `fld${'r'.repeat(16)}`,
        type: 'rollup',
        name: 'Missing Lookup Rollup',
        cellValueType: 'number',
        lookupOptions: {
          foreignTableId,
          linkFieldId,
          lookupFieldId: missingLookupFieldId,
        },
        options: {
          expression: 'countall({values})',
          formatting: { type: 'decimal', precision: 0 },
        },
      },
      new Map([[linkFieldId, 'link']]),
      {
        availableTableIds: new Set([hostTableId, foreignTableId]),
        fieldIdsByTableId,
      }
    );

    expect(normalized.type).toBe('singleLineText');
  });

  it('downgrades relation fields when their host link field is missing', () => {
    const foreignTableId = `tbl${'f'.repeat(16)}`;
    const lookupFieldId = `fld${'v'.repeat(16)}`;

    const normalized = normalizeField(
      {
        id: `fld${'u'.repeat(16)}`,
        type: 'lookup',
        name: 'Missing Link Lookup',
        lookupOptions: {
          foreignTableId,
          linkFieldId: `fld${'l'.repeat(16)}`,
          lookupFieldId,
        },
      },
      new Map(),
      {
        availableTableIds: new Set([foreignTableId]),
        fieldIdsByTableId: new Map([[foreignTableId, new Set([lookupFieldId])]]),
      }
    );

    expect(normalized.type).toBe('singleLineText');
  });

  it('treats link-typed lookup exports as lookup fields, not physical link fields', () => {
    const hostTableId = `tbl${'h'.repeat(16)}`;
    const foreignTableId = `tbl${'f'.repeat(16)}`;
    const hostLinkFieldId = `fld${'l'.repeat(16)}`;
    const lookupLinkFieldId = `fld${'k'.repeat(16)}`;
    const lookupFieldId = `fld${'v'.repeat(16)}`;

    const normalized = normalizeField(
      {
        id: lookupLinkFieldId,
        type: 'link',
        isLookup: true,
        name: 'Looked up link',
        lookupOptions: {
          foreignTableId,
          linkFieldId: hostLinkFieldId,
          lookupFieldId,
        },
      },
      new Map([[hostLinkFieldId, 'link']]),
      {
        availableTableIds: new Set([hostTableId, foreignTableId]),
        fieldIdsByTableId: new Map([[foreignTableId, new Set([lookupFieldId])]]),
      }
    );

    expect(normalized).toMatchObject({
      id: lookupLinkFieldId,
      type: 'lookup',
      options: {
        foreignTableId,
        linkFieldId: hostLinkFieldId,
        lookupFieldId,
      },
    });
  });

  it('preserves required many-one link fields from dottea exports', () => {
    const hostTableId = `tbl${'h'.repeat(16)}`;
    const foreignTableId = `tbl${'f'.repeat(16)}`;
    const primaryFieldId = `fld${'p'.repeat(16)}`;
    const linkFieldId = `fld${'l'.repeat(16)}`;
    const lookupFieldId = `fld${'v'.repeat(16)}`;

    const normalized = normalizeField(
      {
        id: linkFieldId,
        type: 'link',
        name: 'Parent',
        dbFieldName: 'parent',
        notNull: true,
        unique: false,
        options: {
          relationship: 'manyOne',
          foreignTableId,
          lookupFieldId,
          isOneWay: false,
          fkHostTableName: `bse${'b'.repeat(16)}.${hostTableId}`,
          selfKeyName: '__id',
          foreignKeyName: '__fk_parent',
          symmetricFieldId: `fld${'s'.repeat(16)}`,
        },
      },
      new Map([[lookupFieldId, 'singleLineText']]),
      {
        availableTableIds: new Set([hostTableId, foreignTableId]),
        fieldIdsByTableId: new Map([[foreignTableId, new Set([lookupFieldId])]]),
      }
    );

    expect(normalized).toMatchObject({
      id: linkFieldId,
      type: 'link',
      name: 'Parent',
      notNull: true,
      unique: false,
    });

    const normalizedFieldInput = {
      id: normalized.id,
      type: normalized.type,
      name: normalized.name,
      dbFieldName: normalized.dbFieldName,
      notNull: normalized.notNull,
      unique: normalized.unique,
      options: normalized.options,
      config: normalized.config,
    } as ITableFieldInput;

    const result = buildTableFromInput({
      baseId: `bse${'b'.repeat(16)}`,
      tableId: hostTableId,
      name: 'Review Records',
      fields: [
        {
          id: primaryFieldId,
          type: 'singleLineText',
          name: 'Name',
          isPrimary: true,
        },
        normalizedFieldInput,
      ],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.message);
    const linkField = result.value.table
      .getFields()
      .find((field) => field.id().toString() === linkFieldId);
    expect(linkField?.notNull().toBoolean()).toBe(true);
  });

  it('downgrades conditional relation fields when condition fields are not exported', () => {
    const foreignTableId = `tbl${'f'.repeat(16)}`;
    const lookupFieldId = `fld${'v'.repeat(16)}`;

    const normalized = normalizeField(
      {
        id: `fld${'c'.repeat(16)}`,
        type: 'conditionalLookup',
        name: 'Missing Condition Lookup',
        options: {
          foreignTableId,
          lookupFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: `fld${'z'.repeat(16)}`, operator: 'isNotEmpty' }],
            },
          },
        },
      },
      new Map(),
      {
        availableTableIds: new Set([foreignTableId]),
        fieldIdsByTableId: new Map([[foreignTableId, new Set([lookupFieldId])]]),
      }
    );

    expect(normalized.type).toBe('singleLineText');
  });
});
