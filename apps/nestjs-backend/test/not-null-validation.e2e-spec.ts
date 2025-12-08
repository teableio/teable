import type { INestApplication } from '@nestjs/common';
import type { ISelectFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createRecords,
  createTable,
  convertField,
  deleteRecords,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('Not null validation (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('reject missing values for not-null fields', () => {
    let table: ITableFullVo;
    const fieldIds: Record<string, string> = {};

    beforeEach(async () => {
      table = await createTable(baseId, { name: `not-null-${Date.now()}` });
      const existing = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      if (existing.records.length) {
        await deleteRecords(
          table.id,
          existing.records.map((r) => r.id)
        );
      }
      const text = await createField(table.id, {
        name: 'Text',
        type: FieldType.SingleLineText,
      });
      const num = await createField(table.id, {
        name: 'Number',
        type: FieldType.Number,
      });
      const date = await createField(table.id, {
        name: 'Date',
        type: FieldType.Date,
      });
      const rating = await createField(table.id, {
        name: 'Rating',
        type: FieldType.Rating,
      });
      const select = await createField(table.id, {
        name: 'Select',
        type: FieldType.SingleSelect,
        options: {
          choices: [{ id: 'optA', name: 'A' }],
        },
      });

      // Toggle notNull after creation (creation forbids notNull directly)
      const updatedText = await convertField(table.id, text.id, { ...text, notNull: true });
      const updatedNum = await convertField(table.id, num.id, { ...num, notNull: true });
      const updatedDate = await convertField(table.id, date.id, { ...date, notNull: true });
      const updatedRating = await convertField(table.id, rating.id, { ...rating, notNull: true });
      const updatedSelect = await convertField(table.id, select.id, {
        ...select,
        notNull: true,
        options: {
          ...select.options,
          choices: [{ id: 'optA', name: 'A' }],
        } as ISelectFieldOptions,
      });

      fieldIds.text = updatedText.id;
      fieldIds.num = updatedNum.id;
      fieldIds.date = updatedDate.id;
      fieldIds.rating = updatedRating.id;
      fieldIds.select = updatedSelect.id;
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should return validation error when required fields are missing', async () => {
      await createRecords(
        table.id,
        {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: {} }],
        },
        400
      );
    });

    it('should succeed when all required fields are provided', async () => {
      const { records } = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [fieldIds.text]: 'hello',
              [fieldIds.num]: 123,
              [fieldIds.date]: new Date().toISOString(),
              [fieldIds.rating]: 3,
              [fieldIds.select]: 'A',
            },
          },
        ],
      });

      expect(records).toHaveLength(1);
      expect(records[0].fields[fieldIds.text]).toBe('hello');
    });
  });
});
