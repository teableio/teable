import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import {
  createField,
  createRecords,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('Formula COUNTA with lookup ancestors (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts every non-empty ancestor link even when the field is duplicated', async () => {
    let tableId: string | undefined;

    try {
      const table = await createTable(baseId, {
        name: 'formula-counta-lookup-ancestry',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      });
      tableId = table.id;

      const parentField = await createField(tableId, {
        name: 'parent',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyOne, foreignTableId: tableId },
      });

      const ancestor1 = await createField(tableId, {
        name: 'ancestor1',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: tableId,
          linkFieldId: parentField.id,
          lookupFieldId: parentField.id,
        },
      });

      const ancestor2 = await createField(tableId, {
        name: 'ancestor2',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: tableId,
          linkFieldId: parentField.id,
          lookupFieldId: ancestor1.id,
        },
      });

      const ancestor3 = await createField(tableId, {
        name: 'ancestor3',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: tableId,
          linkFieldId: parentField.id,
          lookupFieldId: ancestor2.id,
        },
      });

      const ancestor4 = await createField(tableId, {
        name: 'ancestor4',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: tableId,
          linkFieldId: parentField.id,
          lookupFieldId: ancestor3.id,
        },
      });

      const ancestor5 = await createField(tableId, {
        name: 'ancestor5',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: tableId,
          linkFieldId: parentField.id,
          lookupFieldId: ancestor4.id,
        },
      });

      const levelExpression = `COUNTA({${ancestor5.id}},{${ancestor4.id}},{${ancestor3.id}},{${ancestor2.id}},{${ancestor1.id}},{${parentField.id}})+1`;

      const level = await createField(tableId, {
        name: 'level',
        type: FieldType.Formula,
        options: { expression: levelExpression },
      });

      const levelCopy = await createField(tableId, {
        name: 'level_copy',
        type: FieldType.Formula,
        options: { expression: levelExpression },
      });

      const root = (
        await createRecords(tableId, {
          fieldKeyType: FieldKeyType.Name,
          typecast: true,
          records: [{ fields: { Title: 'root' } }],
        })
      ).records[0];

      const child = (
        await createRecords(tableId, {
          fieldKeyType: FieldKeyType.Name,
          typecast: true,
          records: [{ fields: { Title: 'child', parent: { id: root.id } } }],
        })
      ).records[0];

      const grandchild = (
        await createRecords(tableId, {
          fieldKeyType: FieldKeyType.Name,
          typecast: true,
          records: [{ fields: { Title: 'grandchild', parent: { id: child.id } } }],
        })
      ).records[0];

      const greatGrandchild = (
        await createRecords(tableId, {
          fieldKeyType: FieldKeyType.Name,
          typecast: true,
          records: [{ fields: { Title: 'great-grandchild', parent: { id: grandchild.id } } }],
        })
      ).records[0];

      // Allow computed lookups to propagate
      await new Promise((resolve) => setTimeout(resolve, 200));

      const leaf = await getRecord(tableId, greatGrandchild.id);
      const fields = leaf.fields ?? {};
      // eslint-disable-next-line no-console
      console.log('leaf fields for debug', fields);

      expect(fields[parentField.id]).toMatchObject({ id: grandchild.id });
      expect(fields[level.id]).toBe(4);
      expect(fields[levelCopy.id]).toBe(4);
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });
});
