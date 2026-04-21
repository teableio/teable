import { CellValueType, DbFieldType, FieldType, Relationship } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { TableOpenApiService } from './table-open-api.service';

describe('TableOpenApiService.prepareFields', () => {
  it('prepares same-batch link fields before dependent lookup and rollup fields', async () => {
    const nameFieldRo = {
      id: 'fldName',
      name: 'Name',
      type: FieldType.SingleLineText,
    };
    const linkFieldRo = {
      id: 'fldLink',
      name: 'Company',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeignName',
      },
    };
    const lookupFieldRo = {
      id: 'fldLookup',
      name: 'Company Name',
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        linkFieldId: 'fldLink',
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeignName',
      },
    };
    const rollupFieldRo = {
      id: 'fldRollup',
      name: 'Company Revenue',
      type: FieldType.Rollup,
      options: {
        expression: 'sum({values})',
      },
      lookupOptions: {
        linkFieldId: 'fldLink',
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeignRevenue',
      },
    };

    const preparedNameField = {
      id: 'fldName',
      name: 'Name',
      dbFieldName: 'name',
      type: FieldType.SingleLineText,
      options: {},
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
    const preparedLinkField = {
      id: 'fldLink',
      name: 'Company',
      dbFieldName: 'company',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeignName',
        fkHostTableName: '__link_host',
        selfKeyName: '__fk_self',
        foreignKeyName: '__fk_foreign',
      },
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: undefined,
    };

    const fieldSupplementService = {
      prepareCreateFields: vi.fn().mockResolvedValue([preparedNameField, preparedLinkField]),
      prepareCreateField: vi.fn().mockImplementation(async (_tableId, fieldRo, batchFieldVos) => {
        expect(batchFieldVos).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'fldLink',
              type: FieldType.Link,
              options: expect.objectContaining({
                foreignTableId: 'tblForeign',
                fkHostTableName: '__link_host',
              }),
            }),
          ])
        );

        return {
          id: fieldRo.id,
          name: fieldRo.name,
          dbFieldName: fieldRo.id === 'fldLookup' ? 'company_name' : 'company_revenue',
          type: fieldRo.type,
          isLookup: fieldRo.isLookup,
          options: fieldRo.options ?? {},
          lookupOptions: fieldRo.lookupOptions,
          cellValueType: CellValueType.String,
          dbFieldType: DbFieldType.Text,
        };
      }),
    };

    const service = new TableOpenApiService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      fieldSupplementService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const fields = await (
      service as unknown as {
        prepareFields: (tableId: string, fieldRos: Array<typeof nameFieldRo>) => Promise<unknown[]>;
      }
    ).prepareFields('tblTest', [nameFieldRo, linkFieldRo, lookupFieldRo, rollupFieldRo]);

    expect(fieldSupplementService.prepareCreateFields).toHaveBeenCalledWith('tblTest', [
      nameFieldRo,
      linkFieldRo,
    ]);
    expect(fieldSupplementService.prepareCreateField).toHaveBeenCalledTimes(2);
    expect(fields).toHaveLength(4);
  });
});
