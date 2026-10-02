import { describe, expect, it } from 'vitest';

import { toRestoreFieldCreateInput } from './RestoreFieldSnapshotInput';

describe('toRestoreFieldCreateInput', () => {
  it('normalizes legacy link field trash snapshots for CreateFieldsCommand', () => {
    const result = toRestoreFieldCreateInput({
      id: 'fldSource0000000000',
      name: 'restore link',
      type: 'link',
      description: null,
      options: {
        relationship: 'manyMany',
        foreignTableId: 'tblForeign00000000',
        lookupFieldId: 'fldLookup000000000',
        fkHostTableName: '_junction',
        selfKeyName: '__fk_symmetric',
        foreignKeyName: '__fk_source',
        symmetricFieldId: 'fldSymmetric000000',
        filter: null,
      },
      cellValueType: 'string',
      dbFieldType: 'json',
      dbFieldName: 'fld_source',
      isComputed: false,
      isPending: false,
      hasError: false,
      isMultipleCellValue: true,
      recordRead: true,
      recordCreate: true,
      columnMeta: {},
      references: ['fldSymmetric000000'],
    });

    expect(result.isOk()).toBe(true);
    const field = result._unsafeUnwrap();
    expect(field).toEqual({
      id: 'fldSource0000000000',
      name: 'restore link',
      type: 'link',
      description: null,
      dbFieldName: 'fld_source',
      options: {
        relationship: 'manyMany',
        foreignTableId: 'tblForeign00000000',
        lookupFieldId: 'fldLookup000000000',
        fkHostTableName: '_junction',
        selfKeyName: '__fk_symmetric',
        foreignKeyName: '__fk_source',
        symmetricFieldId: 'fldSymmetric000000',
        filter: null,
      },
    });
  });

  it('normalizes legacy conditional lookup snapshots to conditionalLookup create input', () => {
    const result = toRestoreFieldCreateInput({
      id: 'fldCondLookup00000',
      name: 'IGThumbnail',
      type: 'singleLineText',
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign00000000',
        lookupFieldId: 'fldName0000000000',
        isUnique: true,
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fldFilter000000000',
              operator: 'is',
              value: { type: 'field', fieldId: 'fldRef00000000000' },
            },
          ],
        },
      },
      options: {},
      cellValueType: 'string',
      isMultipleCellValue: false,
      dbFieldType: 'text',
      dbFieldName: 'fld_cond_lookup',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      id: 'fldCondLookup00000',
      name: 'IGThumbnail',
      type: 'conditionalLookup',
      dbFieldName: 'fld_cond_lookup',
      options: {
        foreignTableId: 'tblForeign00000000',
        lookupFieldId: 'fldName0000000000',
        isUnique: true,
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: 'fldFilter000000000',
                operator: 'is',
                value: { type: 'field', fieldId: 'fldRef00000000000' },
              },
            ],
          },
        },
      },
      innerOptions: {},
      isMultipleCellValue: false,
    });
  });

  it('normalizes link-less lookup snapshots without the isConditionalLookup flag', () => {
    const result = toRestoreFieldCreateInput({
      id: 'fldCondLookup00001',
      name: 'conditional lookup',
      type: 'number',
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign00000000',
        lookupFieldId: 'fldAmount00000000',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus00000000', operator: 'is', value: 'done' }],
        },
        sort: { fieldId: 'fldAmount00000000', order: 'desc' },
        limit: 5,
      },
      options: {},
      cellValueType: 'number',
      isMultipleCellValue: true,
      dbFieldType: 'json',
      dbFieldName: 'fld_cond_lookup_1',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      id: 'fldCondLookup00001',
      name: 'conditional lookup',
      type: 'conditionalLookup',
      dbFieldName: 'fld_cond_lookup_1',
      options: {
        foreignTableId: 'tblForeign00000000',
        lookupFieldId: 'fldAmount00000000',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus00000000', operator: 'is', value: 'done' }],
          },
          sort: { fieldId: 'fldAmount00000000', order: 'desc' },
          limit: 5,
        },
      },
      innerOptions: {},
      isMultipleCellValue: true,
    });
  });

  it('normalizes enriched legacy lookup snapshots to lookup create input', () => {
    const result = toRestoreFieldCreateInput({
      id: 'fldLookup000000000',
      name: 'lookup',
      type: 'singleLineText',
      isLookup: true,
      lookupOptions: {
        linkFieldId: 'fldLink0000000000',
        foreignTableId: 'tblForeign00000000',
        lookupFieldId: 'fldName0000000000',
        relationship: 'manyMany',
        fkHostTableName: '_junction',
        selfKeyName: '__fk_symmetric',
        foreignKeyName: '__fk_source',
        filter: null,
      },
      options: {
        showAs: { type: 'url' },
      },
      cellValueType: 'string',
      isMultipleCellValue: true,
      dbFieldType: 'json',
      dbFieldName: 'fld_lookup',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      id: 'fldLookup000000000',
      name: 'lookup',
      type: 'lookup',
      dbFieldName: 'fld_lookup',
      options: {
        linkFieldId: 'fldLink0000000000',
        foreignTableId: 'tblForeign00000000',
        lookupFieldId: 'fldName0000000000',
        filter: null,
      },
      innerOptions: {
        showAs: { type: 'url' },
      },
      isMultipleCellValue: true,
    });
  });
});
