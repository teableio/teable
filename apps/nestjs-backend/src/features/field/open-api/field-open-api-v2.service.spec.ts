/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { CellValueType, DbFieldType, getDefaultFormatting, type IFieldVo } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { FieldOpenApiV2Service } from './field-open-api-v2.service';

type ITestFieldOpenApiV2Service = {
  mapLegacyCreateFieldToV2: (
    ro: Record<string, unknown>,
    table?: {
      getField: (
        predicate: (candidate: {
          id: () => { equals: (id: unknown) => boolean };
          relationship: () => { toString: () => string };
        }) => boolean
      ) =>
        | {
            isErr: () => false;
            value: { relationship: () => { toString: () => string } };
          }
        | {
            isErr: () => true;
          };
    }
  ) => Record<string, unknown>;
  mapConvertFieldToV2: (
    ro: Record<string, unknown>,
    currentField?: Record<string, unknown>
  ) => Record<string, unknown>;
  mapLegacyUpdateFieldToV2: (
    ro: Record<string, unknown>,
    currentField?: Record<string, unknown>
  ) => Record<string, unknown>;
  normalizeFieldVo: (field: unknown) => IFieldVo;
  hasDuplicatedDbFieldName: (
    table: { getFields: () => Array<unknown> },
    dbFieldName: string
  ) => boolean;
  completeLegacyLinkDbConfigForCreate: (
    v2Field: Record<string, unknown>,
    currentTable: {
      dbTableName: () => {
        isErr: () => boolean;
        value: { value: () => { isErr: () => boolean; value: string } };
      };
    },
    tableQueryService: {
      getById: () => Promise<{
        isErr: () => boolean;
        value: {
          dbTableName: () => {
            isErr: () => boolean;
            value: { value: () => { isErr: () => boolean; value: string } };
          };
        };
      }>;
    },
    context: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
};

const createService = () =>
  new FieldOpenApiV2Service(
    {} as never,
    {} as never,
    {} as never
  ) as unknown as ITestFieldOpenApiV2Service;

describe('FieldOpenApiV2Service mapConvertFieldToV2', () => {
  it('maps lookup convert options with filter/sort/limit', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'lookup',
      isLookup: true,
      lookupOptions: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
        sort: { fieldId: 'fldScore0000000001', order: 'desc' },
        limit: 5,
      },
    });

    expect(mapped).toEqual({
      type: 'lookup',
      options: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
        sort: { fieldId: 'fldScore0000000001', order: 'desc' },
        limit: 5,
      },
    });
  });

  it('clears lookup filter/sort/limit when convert payload omits them', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'number',
        isLookup: true,
        lookupOptions: {
          linkFieldId: 'fldLink000000000001',
          lookupFieldId: 'fldLookup000000001',
          foreignTableId: 'tblForeign00000001',
        },
      },
      {
        type: 'number',
        isLookup: true,
        lookupOptions: {
          linkFieldId: 'fldLink000000000001',
          lookupFieldId: 'fldLookup000000001',
          foreignTableId: 'tblForeign00000001',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
          sort: { fieldId: 'fldScore0000000001', order: 'desc' },
          limit: 5,
        },
      }
    );

    expect(mapped).toEqual({
      type: 'lookup',
      options: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        filter: undefined,
        sort: undefined,
        limit: undefined,
      },
    });
  });

  it('maps rollup convert options with foreignTableId and showAs', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'rollup',
      options: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        expression: 'sum({values})',
        formatting: { type: 'decimal', precision: 2 },
        showAs: { type: 'bar', color: 'yellowBright', showValue: true, maxValue: 100 },
        timeZone: 'utc',
      },
    });

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'sum({values})',
        formatting: { type: 'decimal', precision: 2 },
        showAs: { type: 'bar', color: 'yellowBright', showValue: true, maxValue: 100 },
        timeZone: 'utc',
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });
  });

  it('maps rollup convert config from lookupOptions when options omit link ids', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'rollup',
      options: {
        expression: 'countall({values})',
      },
      lookupOptions: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'countall({values})',
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });
  });

  it('maps conditionalRollup convert options with showAs', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'conditionalRollup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        expression: 'array_compact({values})',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
        sort: { fieldId: 'fldScore0000000001', order: 'asc' },
        limit: 1,
        showAs: { type: 'email' },
      },
      cellValueType: 'string',
      isMultipleCellValue: true,
    });

    expect(mapped).toEqual({
      type: 'conditionalRollup',
      cellValueType: 'string',
      isMultipleCellValue: true,
      options: {
        expression: 'array_compact({values})',
        showAs: { type: 'email' },
      },
      config: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
          sort: { fieldId: 'fldScore0000000001', order: 'asc' },
          limit: 1,
        },
      },
    });
  });

  it('omits incomplete conditionalRollup result type in convert payload', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'conditionalRollup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        expression: 'sum({values})',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
      },
      cellValueType: 'number',
    });

    expect(mapped).toEqual({
      type: 'conditionalRollup',
      options: {
        expression: 'sum({values})',
      },
      config: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
      },
    });
  });

  it('maps conditional lookup convert with carried result type from current field', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'formula',
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldLookup000000001',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
        options: {
          expression: 'NOW()',
        },
      },
      {
        type: 'formula',
        cellValueType: 'dateTime',
        isMultipleCellValue: true,
        lookupOptions: {
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldLookup000000001',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
          sort: { fieldId: 'fldScore0000000001', order: 'desc' },
          limit: 1,
        },
      }
    );

    expect(mapped).toEqual({
      type: 'conditionalLookup',
      cellValueType: 'dateTime',
      isMultipleCellValue: true,
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
        innerType: 'formula',
        innerOptions: {
          expression: 'NOW()',
        },
      },
    });
  });

  it('does not carry string result type fallback for formula conditional lookup with formatting', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'formula',
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: 'tblForeign00000001',
          lookupFieldId: 'fldLookup000000001',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
        options: {
          expression: 'NOW()',
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' },
        },
      },
      {
        type: 'formula',
        cellValueType: 'string',
        isMultipleCellValue: true,
      }
    );

    expect(mapped).toEqual({
      type: 'conditionalLookup',
      isMultipleCellValue: true,
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
        innerType: 'formula',
        innerOptions: {
          expression: 'NOW()',
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' },
        },
      },
    });
  });

  it('omits rollup config when config keys are incomplete', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2({
      type: 'rollup',
      options: {
        expression: 'sum({values})',
        showAs: { type: 'email' },
      },
    });

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'sum({values})',
        showAs: { type: 'email' },
      },
    });
  });

  it('marks rollup showAs for clearing when options are replaced', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'rollup',
        options: {
          expression: 'concatenate({values})',
        },
      },
      {
        type: 'rollup',
        options: {
          showAs: { type: 'email' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'rollup',
      options: {
        expression: 'concatenate({values})',
        showAs: null,
      },
    });
  });

  it('marks formula showAs for clearing when options are replaced', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'formula',
        options: {
          expression: '"text"',
        },
      },
      {
        type: 'formula',
        options: {
          showAs: { type: 'email' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'formula',
      options: {
        expression: '"text"',
        showAs: null,
      },
    });
  });

  it('marks singleLineText showAs for clearing on default pass-through mapping', () => {
    const service = createService();
    const mapped = service.mapConvertFieldToV2(
      {
        type: 'singleLineText',
        options: {},
      },
      {
        type: 'singleLineText',
        options: {
          showAs: { type: 'email' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'singleLineText',
      options: {
        showAs: null,
      },
    });
  });

  it('marks formula showAs for clearing on update mapping', () => {
    const service = createService();
    const mapped = service.mapLegacyUpdateFieldToV2(
      {
        type: 'formula',
        options: {
          expression: '"text"',
        },
      },
      {
        type: 'formula',
        options: {
          showAs: { type: 'email' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'formula',
      options: {
        expression: '"text"',
        showAs: null,
      },
    });
  });

  it('marks singleLineText showAs for clearing on update mapping', () => {
    const service = createService();
    const mapped = service.mapLegacyUpdateFieldToV2(
      {
        type: 'singleLineText',
        options: {},
      },
      {
        type: 'singleLineText',
        options: {
          showAs: { type: 'email' },
        },
      }
    );

    expect(mapped).toEqual({
      type: 'singleLineText',
      options: {
        showAs: null,
      },
    });
  });
});

describe('FieldOpenApiV2Service mapLegacyCreateFieldToV2', () => {
  it('passes dbFieldName through create payload', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'singleLineText',
      name: 'TextField',
      dbFieldName: 'fldCustomCreateField001',
    });

    expect(mapped).toMatchObject({
      type: 'singleLineText',
      name: 'TextField',
      dbFieldName: 'fldCustomCreateField001',
    });
  });

  it('passes aiConfig through create payload', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'singleLineText',
      aiConfig: {
        type: 'summary',
        sourceFieldId: 'fldSource000000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'singleLineText',
      aiConfig: {
        type: 'summary',
        sourceFieldId: 'fldSource000000001',
      },
    });
  });

  it('does not keep legacy false lookup multiplicity without link relationship context', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'singleLineText',
      isLookup: true,
      isMultipleCellValue: false,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'lookup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });
    expect(mapped).not.toHaveProperty('isMultipleCellValue');
  });

  it('does not derive lookup multiplicity at openapi mapping layer', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'multipleSelect',
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'lookup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });
    expect(mapped).not.toHaveProperty('isMultipleCellValue');
  });

  it('marks legacy lookup create payload to derive multiplicity in domain layer', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'singleLineText',
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'lookup',
      legacyMultiplicityDerivation: true,
    });
  });

  it('keeps explicit true lookup multiplicity from legacy payload', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'date',
      isLookup: true,
      isMultipleCellValue: true,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'lookup',
      isMultipleCellValue: true,
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        linkFieldId: 'fldLink000000000001',
      },
    });
  });

  it('maps conditional lookup create payload to v2 conditionalLookup input', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'number',
      isLookup: true,
      isConditionalLookup: true,
      options: {
        formatting: {
          type: 'currency',
          precision: 1,
          symbol: '¥',
        },
      },
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
      },
    });

    expect(mapped).toMatchObject({
      type: 'conditionalLookup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
      },
    });
    expect(mapped.id).toEqual(expect.stringMatching(/^fld[\da-zA-Z]{16}$/));
  });

  it('omits incomplete conditionalRollup result type in create payload', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'conditionalRollup',
      cellValueType: 'number',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        expression: 'sum({values})',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
        },
      },
    });

    expect(mapped).toEqual({
      id: expect.any(String),
      type: 'conditionalRollup',
      options: {
        expression: 'sum({values})',
      },
      config: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
        },
      },
    });
  });

  it('maps rollup create payload and splits config from options', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      id: 'fldCreate0000000001',
      type: 'rollup',
      options: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
        expression: 'sum({values})',
      },
    });

    expect(mapped).toEqual({
      id: 'fldCreate0000000001',
      type: 'rollup',
      options: {
        expression: 'sum({values})',
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });
  });

  it('keeps link db config fields in create payload', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'link',
      options: {
        relationship: 'manyMany',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        symmetricFieldId: 'fldSymmetric0000001',
        fkHostTableName: 'bseTestBaseId.junction_custom',
        selfKeyName: '__fk_fldSymmetric0000001',
        foreignKeyName: '__fk_fldCreate0000001',
      },
    });

    expect(mapped).toMatchObject({
      type: 'link',
      options: {
        relationship: 'manyMany',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
        symmetricFieldId: 'fldSymmetric0000001',
        fkHostTableName: 'bseTestBaseId.junction_custom',
        selfKeyName: '__fk_fldSymmetric0000001',
        foreignKeyName: '__fk_fldCreate0000001',
      },
    });
  });

  it('normalizes UTC to utc in create payload options', () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      type: 'formula',
      options: {
        expression: 'NOW()',
        timeZone: 'UTC',
        formatting: {
          date: 'YYYY-MM-DD',
          time: 'HH:mm',
          timeZone: 'UTC',
        },
      },
    });

    expect(mapped).toMatchObject({
      type: 'formula',
      options: {
        expression: 'NOW()',
        timeZone: 'utc',
        formatting: {
          date: 'YYYY-MM-DD',
          time: 'HH:mm',
          timeZone: 'utc',
        },
      },
    });
  });

  it('fills link db config for manyOne when legacy payload misses it', async () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      id: 'fldCreate0000000001',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
      },
    });

    const currentTable = {
      dbTableName: () => ({
        isErr: () => false,
        value: {
          value: () => ({ isErr: () => false, value: 'bseTestBaseId.tblCurrentTable0001' }),
        },
      }),
    };

    const completed = await service.completeLegacyLinkDbConfigForCreate(
      mapped,
      currentTable,
      {
        getById: async () => ({
          isErr: () => true,
          value: currentTable,
        }),
      },
      {}
    );

    expect(completed).toMatchObject({
      type: 'link',
      options: {
        relationship: 'manyOne',
        fkHostTableName: 'bseTestBaseId.tblCurrentTable0001',
        selfKeyName: '__id',
        foreignKeyName: '__fk_fldCreate0000000001',
      },
    });
  });

  it('fills link db config for two-way oneMany from foreign table db name', async () => {
    const service = createService();
    const mapped = service.mapLegacyCreateFieldToV2({
      id: 'fldCreate0000000002',
      type: 'link',
      options: {
        relationship: 'oneMany',
        isOneWay: false,
        foreignTableId: 'tblAbCdEfGhIjKlMn01',
        lookupFieldId: 'fldLookup000000002',
      },
    });

    const currentTable = {
      dbTableName: () => ({
        isErr: () => false,
        value: {
          value: () => ({ isErr: () => false, value: 'bseTestBaseId.tblCurrentTable0002' }),
        },
      }),
    };

    const completed = await service.completeLegacyLinkDbConfigForCreate(
      mapped,
      currentTable,
      {
        getById: async () => ({
          isErr: () => false,
          value: {
            dbTableName: () => ({
              isErr: () => false,
              value: {
                value: () => ({
                  isErr: () => false,
                  value: 'bseTestBaseId.tblForeignPhysical0002',
                }),
              },
            }),
          },
        }),
      },
      {}
    );

    expect(completed).toMatchObject({
      type: 'link',
      options: {
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: 'bseTestBaseId.tblForeignPhysical0002',
      },
    });
    expect((completed.options as { selfKeyName: string }).selfKeyName).toMatch(/^__fk_/);
    expect((completed.options as { foreignKeyName: string }).foreignKeyName).toBe('__id');
    expect((completed.options as { symmetricFieldId?: string }).symmetricFieldId).toMatch(/^fld/);
  });
});

describe('FieldOpenApiV2Service normalizeFieldVo', () => {
  const createNormalizeService = () =>
    new FieldOpenApiV2Service(
      {} as never,
      {} as never,
      {} as never
    ) as unknown as ITestFieldOpenApiV2Service;

  it('derives cellValueType, dbFieldType for singleLineText field', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000001',
      name: 'Text Field',
      type: 'singleLineText',
      dbFieldName: 'text_field',
      options: {},
    });

    expect(vo.cellValueType).toBe(CellValueType.String);
    expect(vo.dbFieldType).toBe(DbFieldType.Text);
    expect(vo.dbFieldName).toBe('text_field');
  });

  it('derives cellValueType, dbFieldType for number field', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000002',
      name: 'Number Field',
      type: 'number',
      dbFieldName: 'number_field',
      options: { formatting: { type: 'decimal', precision: 2 } },
    });

    expect(vo.cellValueType).toBe(CellValueType.Number);
    expect(vo.dbFieldType).toBe(DbFieldType.Real);
    expect(vo.dbFieldName).toBe('number_field');
  });

  it('derives cellValueType, dbFieldType for checkbox field', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000003',
      name: 'Checkbox',
      type: 'checkbox',
      dbFieldName: 'checkbox_field',
      options: {},
    });

    expect(vo.cellValueType).toBe(CellValueType.Boolean);
    expect(vo.dbFieldType).toBe(DbFieldType.Boolean);
  });

  it('derives cellValueType, dbFieldType for date field', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000004',
      name: 'Date',
      type: 'date',
      dbFieldName: 'date_field',
      options: {},
    });

    expect(vo.cellValueType).toBe(CellValueType.DateTime);
    expect(vo.dbFieldType).toBe(DbFieldType.DateTime);
  });

  it('derives isMultipleCellValue and JSON dbFieldType for multipleSelect', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000005',
      name: 'Multi Select',
      type: 'multipleSelect',
      dbFieldName: 'multi_select',
      options: { choices: [] },
    });

    expect(vo.cellValueType).toBe(CellValueType.String);
    expect(vo.isMultipleCellValue).toBe(true);
    expect(vo.dbFieldType).toBe(DbFieldType.Json);
  });

  it('derives JSON dbFieldType for link field', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000006',
      name: 'Link',
      type: 'link',
      dbFieldName: 'link_field',
      options: { foreignTableId: 'tblForeign00000001', relationship: 'manyMany' },
    });

    expect(vo.cellValueType).toBe(CellValueType.String);
    expect(vo.dbFieldType).toBe(DbFieldType.Json);
  });

  it('preserves cellValueType when already present (formula/rollup)', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000007',
      name: 'Rollup',
      type: 'rollup',
      dbFieldName: 'rollup_field',
      cellValueType: 'number',
      isMultipleCellValue: false,
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });

    expect(vo.cellValueType).toBe(CellValueType.Number);
    expect(vo.dbFieldType).toBe(DbFieldType.Real);
  });

  it('applies legacy number formatting fallback for numeric rollup expressions', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldRollupNormalize0002',
      name: 'Rollup Numeric Fallback',
      type: 'rollup',
      dbFieldName: 'rollup_numeric_fallback',
      cellValueType: 'string',
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });

    expect((vo.options as Record<string, unknown>).formatting).toEqual(
      getDefaultFormatting(CellValueType.Number)
    );
  });

  it('does not override existing rollup formatting when expression is numeric', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldRollupNormalize0003',
      name: 'Rollup Keep Formatting',
      type: 'rollup',
      dbFieldName: 'rollup_keep_formatting',
      options: {
        expression: 'sum({values})',
        formatting: { type: 'decimal', precision: 5 },
      },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });

    expect((vo.options as Record<string, unknown>).formatting).toEqual({
      type: 'decimal',
      precision: 5,
    });
  });

  it('derives rating field as number type', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000008',
      name: 'Rating',
      type: 'rating',
      dbFieldName: 'rating_field',
      options: { icon: 'star', color: 'yellowBright', max: 5 },
    });

    expect(vo.cellValueType).toBe(CellValueType.Number);
    expect(vo.dbFieldType).toBe(DbFieldType.Real);
  });

  it('derives autoNumber field as number/integer type', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000009',
      name: 'AutoNumber',
      type: 'autoNumber',
      dbFieldName: 'auto_number',
      options: { expression: 'ROW()' },
    });

    expect(vo.cellValueType).toBe(CellValueType.Number);
    expect(vo.dbFieldType).toBe(DbFieldType.Integer);
  });

  it('strips symmetricFieldId from OneWay link fields', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000011',
      name: 'OneWay Link',
      type: 'link',
      dbFieldName: 'oneway_link',
      options: {
        foreignTableId: 'tblForeign00000001',
        relationship: 'oneMany',
        isOneWay: true,
        symmetricFieldId: 'fldooa6hL67OXgi4cHj',
      },
    });

    expect(vo.type).toBe('link');
    expect((vo.options as Record<string, unknown>).isOneWay).toBe(true);
    expect((vo.options as Record<string, unknown>).symmetricFieldId).toBeUndefined();
    expect((vo.options as Record<string, unknown>).foreignTableId).toBe('tblForeign00000001');
  });

  it('preserves symmetricFieldId for TwoWay link fields', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000012',
      name: 'TwoWay Link',
      type: 'link',
      dbFieldName: 'twoway_link',
      options: {
        foreignTableId: 'tblForeign00000001',
        relationship: 'manyMany',
        symmetricFieldId: 'fldSymmetric000001',
      },
    });

    expect(vo.type).toBe('link');
    expect((vo.options as Record<string, unknown>).symmetricFieldId).toBe('fldSymmetric000001');
  });

  it('keeps unique undefined when missing', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldTest0000000010',
      name: 'Text',
      type: 'singleLineText',
      options: {},
    });

    expect(vo.unique).toBeUndefined();
  });

  it('omits false isMultipleCellValue for v1 compatibility', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldButtonNormalize0001',
      name: 'Button',
      type: 'button',
      dbFieldName: 'button_field',
      isMultipleCellValue: false,
      options: {
        label: 'Run',
        color: 'red',
      },
    });

    expect(vo.isMultipleCellValue).toBeUndefined();
  });

  it('strips undefined keys from options payload', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldButtonNormalize0002',
      name: 'Button',
      type: 'button',
      dbFieldName: 'button_field_2',
      options: {
        label: 'Run',
        workflow: undefined,
      },
    });

    expect(vo.options).toEqual({
      label: 'Run',
    });
  });

  it('omits false isMultipleCellValue for rollup field output compatibility', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldRollupNormalize0001',
      name: 'Rollup',
      type: 'rollup',
      dbFieldName: 'rollup_field',
      cellValueType: 'number',
      isMultipleCellValue: false,
      options: { expression: 'sum({values})' },
      config: {
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    });

    expect(vo.isMultipleCellValue).toBeUndefined();
    expect(vo.cellValueType).toBe(CellValueType.Number);
  });

  it('normalizes lookup options to empty object when source options are null', () => {
    const service = createNormalizeService();
    const vo = service.normalizeFieldVo({
      id: 'fldLookupNormalize0001',
      name: 'Lookup Field',
      type: 'singleLineText',
      isLookup: true,
      options: null,
      lookupOptions: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldSource000000001',
        linkFieldId: 'fldLink0000000001',
      },
    });

    expect(vo.options).toEqual({});
  });
});

describe('FieldOpenApiV2Service hasDuplicatedDbFieldName', () => {
  it('returns true when dbFieldName already exists in table', () => {
    const service = createService();
    const table = {
      getFields: () => [
        {
          dbFieldName: () => ({
            andThen: (
              fn: (name: { value: () => { isOk: () => boolean; value: string } }) => unknown
            ) => fn({ value: () => ({ isOk: () => true, value: 'fld_existing_db_name' }) }),
          }),
        },
      ],
    };

    expect(service.hasDuplicatedDbFieldName(table, 'fld_existing_db_name')).toBe(true);
  });

  it('returns false when dbFieldName does not exist in table', () => {
    const service = createService();
    const table = {
      getFields: () => [
        {
          dbFieldName: () => ({
            andThen: (
              fn: (name: { value: () => { isOk: () => boolean; value: string } }) => unknown
            ) => fn({ value: () => ({ isOk: () => true, value: 'fld_other_db_name' }) }),
          }),
        },
      ],
    };

    expect(service.hasDuplicatedDbFieldName(table, 'fld_missing_db_name')).toBe(false);
  });
});
