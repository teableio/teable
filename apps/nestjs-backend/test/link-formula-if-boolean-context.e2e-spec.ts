/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions, IFieldVo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, getRandomString } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  convertField,
  createField,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Formula IF link boolean context (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps link titles when IF branches reference link fields', async () => {
    const suffix = getRandomString(8);
    let tableA: ITableFullVo | undefined;
    let tableB: ITableFullVo | undefined;

    try {
      tableA = await createTable(baseId, {
        name: `LinkIf_A_${suffix}`,
        fields: [{ name: 'A Name', type: FieldType.SingleLineText }],
        records: [{ fields: { 'A Name': 'Alpha' } }],
      });

      tableB = await createTable(baseId, {
        name: `LinkIf_B_${suffix}`,
        fields: [
          { name: 'B Primary', type: FieldType.SingleLineText },
          { name: 'Active', type: FieldType.Checkbox },
          { name: 'Empty Text', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { 'B Primary': 'Row-1', Active: true, 'Empty Text': 'ignore' } },
          { fields: { 'B Primary': 'Row-2', Active: false, 'Empty Text': '' } },
        ],
      });

      const primaryFieldB = tableB.fields[0];
      const activeField = tableB.fields.find((field) => field.name === 'Active') as IFieldVo;
      const emptyTextField = tableB.fields.find((field) => field.name === 'Empty Text') as IFieldVo;

      const linkAtoB = await createField(tableA.id, {
        name: 'Link to B',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: tableB.id,
        },
      } as IFieldRo);

      const symmetricLinkId = (linkAtoB.options as ILinkFieldOptions).symmetricFieldId as string;
      if (!symmetricLinkId) {
        throw new Error('Symmetric link field not created');
      }

      await convertField(tableB.id, primaryFieldB.id, {
        type: FieldType.Formula,
        options: {
          expression: `IF({${activeField.id}}, {${symmetricLinkId}}, {${emptyTextField.id}})`,
        },
      });

      // Include title so formula branch can resolve a display value without relying on CTE ordering.
      await updateRecordByApi(tableB.id, tableB.records[0].id, symmetricLinkId, {
        id: tableA.records[0].id,
        title: 'Alpha',
      });

      const tableARecords = await getRecords(tableA.id, {
        fieldKeyType: FieldKeyType.Id,
        projection: [linkAtoB.id],
      });

      const aRecord = tableARecords.records.find((r) => r.id === tableA!.records[0].id);
      expect(aRecord).toBeDefined();

      const aLinkValues = aRecord?.fields[linkAtoB.id] as Array<{ id: string; title?: string }>;
      expect(Array.isArray(aLinkValues)).toBe(true);
      expect(aLinkValues).toHaveLength(1);
      expect(aLinkValues[0].id).toBe(tableB.records[0].id);
      expect(aLinkValues[0].title).toBe('Alpha');
      expect(aLinkValues[0].title).not.toBe('true');

      const tableBRecords = await getRecords(tableB.id, {
        fieldKeyType: FieldKeyType.Id,
        projection: [primaryFieldB.id],
      });

      expect(tableBRecords.records).toHaveLength(2);
      const row1 = tableBRecords.records.find((record) => record.id === tableB!.records[0].id);
      expect(row1?.fields[primaryFieldB.id]).toBe('Alpha');
    } finally {
      if (tableA) {
        await permanentDeleteTable(baseId, tableA.id);
      }
      if (tableB) {
        await permanentDeleteTable(baseId, tableB.id);
      }
    }
  });
});
