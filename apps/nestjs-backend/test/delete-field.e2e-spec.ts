/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */

import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { convertField } from '@teable/openapi';
import {
  createField,
  createTable,
  deleteField,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('OpenAPI delete field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let prisma: PrismaService;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('basic delete field tests', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Delete Field Test Table',
        fields: [
          {
            name: 'Primary Field',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Text Field',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Number Field',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              'Primary Field': 'Record 1',
              'Text Field': 'Text 1',
              'Number Field': 100,
            },
          },
          {
            fields: {
              'Primary Field': 'Record 2',
              'Text Field': 'Text 2',
              'Number Field': 200,
            },
          },
        ],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('should delete a simple text field', async () => {
      const textField = table.fields.find((f) => f.name === 'Text Field')!;

      // Delete the field
      await deleteField(table.id, textField.id);

      // Verify field is marked as deleted in database
      const fieldRaw = await prisma.field.findUnique({
        where: { id: textField.id },
      });
      expect(fieldRaw?.deletedTime).toBeTruthy();

      // Verify records can still be retrieved
      const records = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records.records).toHaveLength(2);
      expect(records.records[0].fields[textField.id]).toBeUndefined();
    });

    it('should delete a number field', async () => {
      const numberField = table.fields.find((f) => f.name === 'Number Field')!;

      // Delete the field
      await deleteField(table.id, numberField.id);

      // Verify field is marked as deleted in database
      const fieldRaw = await prisma.field.findUnique({
        where: { id: numberField.id },
      });
      expect(fieldRaw?.deletedTime).toBeTruthy();

      // Verify records can still be retrieved
      const records = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records.records).toHaveLength(2);
      expect(records.records[0].fields[numberField.id]).toBeUndefined();
    });

    it('should forbid deleting primary field', async () => {
      const primaryField = table.fields.find((f) => f.name === 'Primary Field')!;

      // Attempt to delete primary field should fail
      await expect(deleteField(table.id, primaryField.id)).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe('delete field with formula dependencies', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Formula Dependencies Test Table',
        fields: [
          {
            name: 'Primary Field',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Source Field',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          {
            fields: {
              'Primary Field': 'Record 1',
              'Source Field': 'Source 1',
            },
          },
          {
            fields: {
              'Primary Field': 'Record 2',
              'Source Field': 'Source 2',
            },
          },
        ],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('should delete field referenced by formula', async () => {
      const sourceField = table.fields.find((f) => f.name === 'Source Field')!;

      // Create a formula field that references the source field
      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Formula Field',
        options: {
          expression: `UPPER({${sourceField.id}})`,
        },
      });

      // Verify formula field works
      const recordsBefore = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordsBefore.records[0].fields[formulaField.id]).toBe('SOURCE 1');

      // Delete the source field
      await deleteField(table.id, sourceField.id);

      // Verify source field is deleted
      const fieldRaw = await prisma.field.findUnique({
        where: { id: sourceField.id },
      });
      expect(fieldRaw?.deletedTime).toBeTruthy();

      // Verify reference is cleaned up
      const referenceAfter = await prisma.reference.findFirst({
        where: { fromFieldId: sourceField.id },
      });
      expect(referenceAfter).toBeFalsy();

      // Verify records can still be retrieved
      const recordsAfter = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordsAfter.records).toHaveLength(2);
    });
  });

  describe('special case: primary field converted to formula', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Primary Formula Test Table',
        fields: [
          {
            name: 'Primary Field',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Reference Field 1',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Reference Field 2',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          {
            fields: {
              'Primary Field': 'Original Primary 1',
              'Reference Field 1': 'Ref1 Value 1',
              'Reference Field 2': 'Ref2 Value 1',
            },
          },
          {
            fields: {
              'Primary Field': 'Original Primary 2',
              'Reference Field 1': 'Ref1 Value 2',
              'Reference Field 2': 'Ref2 Value 2',
            },
          },
        ],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('should handle deleting referenced field when primary field is converted to formula', async () => {
      const primaryField = table.fields.find((f) => f.name === 'Primary Field')!;
      const referenceField1 = table.fields.find((f) => f.name === 'Reference Field 1')!;
      const referenceField2 = table.fields.find((f) => f.name === 'Reference Field 2')!;

      // Create a formula field that references both reference fields
      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Helper Formula',
        options: {
          expression: `CONCATENATE({${referenceField1.id}}, " - ", {${referenceField2.id}})`,
        },
      });

      // Verify the formula field works
      const recordsBeforeConvert = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordsBeforeConvert.records[0].fields[formulaField.id]).toBe(
        'Ref1 Value 1 - Ref2 Value 1'
      );

      // Convert primary field to formula that references the helper formula
      await convertField(table.id, primaryField.id, {
        type: FieldType.Formula,
        options: {
          expression: `UPPER({${formulaField.id}})`,
        },
      });

      // Verify primary field is now a formula
      const recordsAfterConvert = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordsAfterConvert.records[0].fields[primaryField.id]).toBe(
        'REF1 VALUE 1 - REF2 VALUE 1'
      );
      expect(recordsAfterConvert.records[1].fields[primaryField.id]).toBe(
        'REF1 VALUE 2 - REF2 VALUE 2'
      );

      // Now delete the reference field that the helper formula depends on
      await deleteField(table.id, referenceField2.id);

      // Verify the reference field is deleted
      const fieldRaw = await prisma.field.findUnique({
        where: { id: referenceField2.id },
      });
      expect(fieldRaw?.deletedTime).toBeTruthy();

      // Verify references are cleaned up
      const referenceAfter = await prisma.reference.findFirst({
        where: { fromFieldId: referenceField2.id },
      });
      expect(referenceAfter).toBeFalsy();

      // Most importantly: verify that the primary field still exists and records can be retrieved
      const recordsAfterDelete = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordsAfterDelete.records).toHaveLength(2);

      // The primary field should still be accessible (even if its formula is broken)
      expect(recordsAfterDelete.records[0].fields[primaryField.id]).toBeUndefined();
      expect(recordsAfterDelete.records[1].fields[primaryField.id]).toBeUndefined();

      // Verify the primary field still exists in the database
      const primaryFieldRaw = await prisma.field.findUnique({
        where: { id: primaryField.id },
      });
      expect(primaryFieldRaw?.deletedTime).toBeFalsy();
      expect(primaryFieldRaw?.isPrimary).toBe(true);
    });

    it('should handle complex formula chain when deleting intermediate field', async () => {
      const primaryField = table.fields.find((f) => f.name === 'Primary Field')!;
      const referenceField1 = table.fields.find((f) => f.name === 'Reference Field 1')!;
      const referenceField2 = table.fields.find((f) => f.name === 'Reference Field 2')!;

      // Create a chain: referenceField1 -> intermediateFormula -> primaryField (converted to formula)
      const intermediateFormula = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Intermediate Formula',
        options: {
          expression: `UPPER({${referenceField1.id}})`,
        },
      });

      // Convert primary field to reference the intermediate formula
      await convertField(table.id, primaryField.id, {
        type: FieldType.Formula,
        options: {
          expression: `CONCATENATE("Primary: ", {${intermediateFormula.id}})`,
        },
      });

      // Verify the chain works
      const recordsBeforeDelete = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordsBeforeDelete.records[0].fields[primaryField.id]).toBe('Primary: REF1 VALUE 1');

      // Delete the intermediate formula field
      await deleteField(table.id, intermediateFormula.id);

      // Verify intermediate formula is deleted
      const intermediateFieldRaw = await prisma.field.findUnique({
        where: { id: intermediateFormula.id },
      });
      expect(intermediateFieldRaw?.deletedTime).toBeTruthy();

      // Verify references are cleaned up
      const referenceAfter = await prisma.reference.findFirst({
        where: {
          OR: [{ fromFieldId: intermediateFormula.id }, { toFieldId: intermediateFormula.id }],
        },
      });
      expect(referenceAfter).toBeFalsy();

      // Most importantly: verify primary field still exists and table is accessible
      const recordsAfterDelete = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordsAfterDelete.records).toHaveLength(2);

      // Primary field should still exist even if its formula is broken
      const primaryFieldRaw = await prisma.field.findUnique({
        where: { id: primaryField.id },
      });
      expect(primaryFieldRaw?.deletedTime).toBeFalsy();
      expect(primaryFieldRaw?.isPrimary).toBe(true);
    });
  });
});
