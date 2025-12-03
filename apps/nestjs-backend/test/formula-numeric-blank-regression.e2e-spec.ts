/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, generateFieldId } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { duplicateField } from '@teable/openapi';
import { createTable, getRecords, initApp, permanentDeleteTable } from './utils/init-app';

/**
 * Regression: duplicating a formula that compares a numeric field to '' should not
 * produce 22P02 (invalid input syntax for type double precision).
 */
describe('Formula numeric blank comparison duplication (regression)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId as string;

  beforeAll(async () => {
    const ctx = await initApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('duplicates formula comparing number field with empty string without errors', async () => {
    const percentFieldId = generateFieldId();
    const table = (await createTable(baseId, {
      name: 'numeric_blank_dup',
      fields: [
        {
          id: percentFieldId,
          name: 'Percent',
          type: FieldType.Number,
        },
        {
          name: 'PercentColor',
          type: FieldType.Formula,
          options: {
            // Use field id in expression to avoid name-resolution failures.
            expression: `IF({${percentFieldId}}="", "empty", "filled")`,
          },
        },
      ],
      records: [
        { fields: {} }, // Percent is null
        { fields: { Percent: 0.2 } },
      ],
    })) as ITableFullVo;

    try {
      const formulaFieldId = table.fields.find((f) => f.name === 'PercentColor')?.id as string;

      const duplicated = await duplicateField(table.id, formulaFieldId, {
        name: 'PercentColor Copy',
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });

      const first = records[0];
      const second = records[1];

      expect(first.fields[formulaFieldId]).toBe('empty');
      expect(first.fields[duplicated.data.id]).toBe('empty');
      expect(second.fields[formulaFieldId]).toBe('filled');
      expect(second.fields[duplicated.data.id]).toBe('filled');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('duplicates IF with blank fallback comparing number field with empty string without errors', async () => {
    const percentFieldId = generateFieldId();
    const table = (await createTable(baseId, {
      name: 'numeric_blank_dup_two_arg',
      fields: [
        {
          id: percentFieldId,
          name: 'Percent',
          type: FieldType.Number,
        },
        {
          name: 'PercentColor',
          type: FieldType.Formula,
          options: {
            expression: `IF({${percentFieldId}}="", "empty", BLANK())`,
          },
        },
      ],
      records: [
        { fields: {} }, // Percent is null
        { fields: { Percent: 0.2 } },
      ],
    })) as ITableFullVo;

    try {
      const formulaFieldId = table.fields.find((f) => f.name === 'PercentColor')?.id as string;

      const duplicated = await duplicateField(table.id, formulaFieldId, {
        name: 'PercentColor Copy 2',
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });

      const first = records[0];
      const second = records[1];

      expect(first.fields[formulaFieldId]).toBe('empty');
      expect(first.fields[duplicated.data.id]).toBe('empty');
      expect(second.fields[formulaFieldId] ?? null).toBeNull();
      expect(second.fields[duplicated.data.id] ?? null).toBeNull();
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
