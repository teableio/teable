/**
 * T1756: Link field NOT NULL constraint sync bug
 *
 * Steps to reproduce:
 * 1. Create a Number field
 * 2. Set notNull=true on the Number field
 * 3. Convert it to a Link field
 * 4. Edit the Link field and turn off notNull
 * 5. Try to create a record with empty Link value - FAILS because DB constraint still exists
 */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  convertField,
  createRecords,
  getField,
  initApp,
  permanentDeleteTable,
  deleteRecords,
  getRecords,
} from './utils/init-app';

describe('T1756: Link field NOT NULL constraint sync bug', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('bug reproduction', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeEach(async () => {
      table1 = await createTable(baseId, { name: `table1-${Date.now()}` });
      table2 = await createTable(baseId, { name: `table2-${Date.now()}` });

      // Clear default records
      const records1 = await getRecords(table1.id);
      const records2 = await getRecords(table2.id);
      if (records1.records.length) {
        await deleteRecords(
          table1.id,
          records1.records.map((r) => r.id)
        );
      }
      if (records2.records.length) {
        await deleteRecords(
          table2.id,
          records2.records.map((r) => r.id)
        );
      }
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should allow creating record with empty Link after removing notNull constraint', async () => {
      // Step 1: Create a Number field
      const numberField = await createField(table1.id, {
        name: 'TestField',
        type: FieldType.Number,
      });

      // Step 2: Set notNull=true on the Number field
      await convertField(table1.id, numberField.id, {
        ...numberField,
        notNull: true,
      });

      // Step 3: Convert to Link field
      const linkField = await convertField(table1.id, numberField.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      });

      // Step 4: Turn off notNull on the Link field
      const linkFieldFull = await getField(table1.id, linkField.id);
      const updatedLinkField = await convertField(table1.id, linkField.id, {
        ...linkFieldFull,
        notNull: false,
      });

      // Verify metadata shows notNull is false
      expect(updatedLinkField.notNull).toBeFalsy();

      // Step 5: Try to create a record with empty Link value
      // BUG: This should succeed since notNull is false in metadata
      // But it fails because DB still has NOT NULL constraint
      const result = await createRecords(
        table1.id,
        {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: {} }], // Empty record, no Link value
        },
        201 // Expect success (201), but will get 500 due to DB constraint
      );

      expect(result.records).toHaveLength(1);
    });

    it('should not allow creating record with empty Link after setting notNull constraint', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      });
      const linkFieldFull = await getField(table1.id, linkField.id);
      await convertField(table1.id, linkField.id, {
        ...linkFieldFull,
        notNull: true,
      });
      await createRecords(
        table1.id,
        {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: {} }], // Empty record, no Link value
        },
        400 // Expect success (201), but will get 500 due to DB constraint
      );
    });
  });
});
