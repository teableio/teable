import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  convertField,
  createField,
  createTable,
  getField,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Link field multi-config toggle regression (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('preserves source links when converting manyOne twoWay to manyMany oneWay with formula lookup titles', async () => {
    let sourceTable: ITableFullVo | undefined;
    let foreignTable: ITableFullVo | undefined;

    try {
      sourceTable = await createTable(baseId, {
        name: 'Survey Responses',
        fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true } as IFieldRo],
        records: [{ fields: { Name: 'Response A' } }, { fields: { Name: 'Response B' } }],
      });

      foreignTable = await createTable(baseId, {
        name: 'Campuses',
        fields: [
          { name: 'Branch', type: FieldType.SingleLineText, isPrimary: true } as IFieldRo,
          { name: 'District', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Center', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Room', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          {
            fields: {
              Branch: 'Branch A',
              District: 'District A',
              Center: 'Center A',
              Room: 'Room A',
            },
          },
          {
            fields: {
              Branch: 'Branch B',
              District: 'District B',
              Center: 'Center B',
              Room: 'Room B',
            },
          },
        ],
      });

      const branchField = foreignTable.fields.find((field) => field.name === 'Branch');
      const districtField = foreignTable.fields.find((field) => field.name === 'District');
      const centerField = foreignTable.fields.find((field) => field.name === 'Center');
      const roomField = foreignTable.fields.find((field) => field.name === 'Room');
      expect(branchField && districtField && centerField && roomField).toBeDefined();

      const formulaField = await createField(foreignTable.id, {
        name: 'Campus Info',
        type: FieldType.Formula,
        options: {
          expression: `{${branchField!.id}}&"/"&{${districtField!.id}}&"/"&{${centerField!.id}}&"/"&{${roomField!.id}}`,
        },
      } as IFieldRo);

      const linkField = await createField(sourceTable.id, {
        name: 'Campus Info',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
          lookupFieldId: formulaField.id,
          isOneWay: false,
        },
      } as IFieldRo);

      const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;
      expect(symmetricFieldId).toBeDefined();

      await updateRecordByApi(sourceTable.id, sourceTable.records[0].id, linkField.id, {
        id: foreignTable.records[0].id,
      });
      await updateRecordByApi(sourceTable.id, sourceTable.records[1].id, linkField.id, {
        id: foreignTable.records[0].id,
      });

      const convertedField = await convertField(sourceTable.id, linkField.id, {
        name: linkField.name,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
          lookupFieldId: formulaField.id,
          isOneWay: true,
        },
      });

      expect(convertedField.options).toMatchObject({
        relationship: Relationship.ManyMany,
        foreignTableId: foreignTable.id,
        isOneWay: true,
      });
      expect((convertedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

      const sourceRecords = await getRecords(sourceTable.id, {
        fieldKeyType: FieldKeyType.Id,
      });
      const firstRecord = sourceRecords.records.find(
        (record) => record.id === sourceTable.records[0].id
      );
      const secondRecord = sourceRecords.records.find(
        (record) => record.id === sourceTable.records[1].id
      );

      expect(firstRecord?.fields[linkField.id]).toEqual([
        expect.objectContaining({
          id: foreignTable.records[0].id,
          title: 'Branch A/District A/Center A/Room A',
        }),
      ]);
      expect(secondRecord?.fields[linkField.id]).toEqual([
        expect.objectContaining({
          id: foreignTable.records[0].id,
          title: 'Branch A/District A/Center A/Room A',
        }),
      ]);

      await expect(getField(foreignTable.id, symmetricFieldId!)).rejects.toThrow();
    } finally {
      if (sourceTable) {
        await permanentDeleteTable(baseId, sourceTable.id);
      }
      if (foreignTable) {
        await permanentDeleteTable(baseId, foreignTable.id);
      }
    }
  });
});
