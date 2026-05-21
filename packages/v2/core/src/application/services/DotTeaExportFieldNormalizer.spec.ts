import { describe, expect, it } from 'vitest';

import { normalizeDotTeaExportFieldsForSelfContainedBase } from './DotTeaExportFieldNormalizer';
import type { DotTeaExportField } from './DotTeaExportFieldNormalizer';

const baseField = (field: Partial<DotTeaExportField> & Pick<DotTeaExportField, 'id'>) => ({
  name: field.id,
  dbFieldName: field.id,
  createdTime: '2026-01-01T00:00:00.000Z',
  order: 0,
  type: 'singleLineText',
  ...field,
});

describe('normalizeDotTeaExportFieldsForSelfContainedBase', () => {
  it('converts cross-base link fields to single line text', () => {
    const fields = [
      baseField({
        id: 'fldLink',
        type: 'link',
        options: {
          baseId: 'bseForeign',
          foreignTableId: 'tblForeign',
          lookupFieldId: 'fldPrimary',
        },
        isMultipleCellValue: true,
      }),
    ];

    const [field] = normalizeDotTeaExportFieldsForSelfContainedBase(fields);

    expect(field?.type).toBe('singleLineText');
    expect(field?.options).toBeUndefined();
    expect(field?.lookupOptions).toBeUndefined();
    expect(field?.isLookup).toBeUndefined();
    expect(field?.isConditionalLookup).toBeUndefined();
    expect(field?.isMultipleCellValue).toBeUndefined();
  });

  it('converts lookup or rollup fields that depend on cross-base link fields', () => {
    const fields = [
      baseField({
        id: 'fldCrossBaseLink',
        type: 'link',
        options: {
          baseId: 'bseForeign',
          foreignTableId: 'tblForeign',
          lookupFieldId: 'fldPrimary',
        },
      }),
      baseField({
        id: 'fldLookup',
        type: 'lookup',
        isLookup: true,
        lookupOptions: {
          linkFieldId: 'fldCrossBaseLink',
          lookupFieldId: 'fldName',
          foreignTableId: 'tblForeign',
        },
      }),
      baseField({
        id: 'fldRollup',
        type: 'rollup',
        options: {
          linkFieldId: 'fldCrossBaseLink',
          lookupFieldId: 'fldAmount',
          foreignTableId: 'tblForeign',
        },
        lookupOptions: {
          linkFieldId: 'fldCrossBaseLink',
          lookupFieldId: 'fldAmount',
          foreignTableId: 'tblForeign',
        },
      }),
    ];

    const [, lookup, rollup] = normalizeDotTeaExportFieldsForSelfContainedBase(fields);

    expect(lookup?.type).toBe('singleLineText');
    expect(lookup?.dbFieldType).toBe('TEXT');
    expect(lookup?.cellValueType).toBe('string');
    expect(lookup?.lookupOptions).toBeUndefined();
    expect(rollup?.type).toBe('singleLineText');
    expect(rollup?.dbFieldType).toBe('TEXT');
    expect(rollup?.cellValueType).toBe('string');
    expect(rollup?.options).toBeUndefined();
  });

  it('converts direct cross-base conditional fields', () => {
    const fields = [
      baseField({
        id: 'fldConditionalLookup',
        type: 'conditionalLookup',
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          baseId: 'bseForeign',
          foreignTableId: 'tblForeign',
          lookupFieldId: 'fldName',
        },
      }),
      baseField({
        id: 'fldConditionalRollup',
        type: 'conditionalRollup',
        options: {
          baseId: 'bseForeign',
          foreignTableId: 'tblForeign',
          lookupFieldId: 'fldAmount',
        },
      }),
    ];

    const normalized = normalizeDotTeaExportFieldsForSelfContainedBase(fields);

    expect(normalized.map((field) => field.type)).toEqual(['singleLineText', 'singleLineText']);
    expect(normalized.every((field) => field.dbFieldType === 'TEXT')).toBe(true);
    expect(normalized.every((field) => field.cellValueType === 'string')).toBe(true);
    expect(normalized.every((field) => field.options === undefined)).toBe(true);
    expect(normalized.every((field) => field.lookupOptions === undefined)).toBe(true);
  });

  it('preserves cross-base field shape when cross-base export is allowed', () => {
    const fields = [
      baseField({
        id: 'fldLink',
        type: 'link',
        options: {
          baseId: 'bseForeign',
        },
      }),
    ];

    const [field] = normalizeDotTeaExportFieldsForSelfContainedBase(fields, {
      allowCrossBase: true,
    });

    expect(field).toEqual(fields[0]);
    expect(field).not.toBe(fields[0]);
  });
});
