/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, generateFieldId } from '@teable/core';
import {
  createRecords,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

/**
 * Tests for DATETIME_PARSE formula parsing and updates.
 *
 * This test suite verifies:
 * 1. DATETIME_PARSE correctly parses both single-digit (e.g., "2026-9-15") and
 *    double-digit (e.g., "2026-09-15") month/day formats.
 * 2. Formula fields using DATETIME_PARSE correctly recalculate when source fields change.
 *
 * Related fix: DEFAULT_DATETIME_PARSE_PATTERN was updated to accept [0-9]{1,2}
 * for month and day instead of requiring [0-9]{2}.
 */
describe('Formula DATETIME_PARSE update semantics (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Test basic DATETIME_PARSE functionality with zero-padded format.
   * This should work in both v1 and v2.
   */
  it('parses zero-padded date format correctly', async () => {
    let tableId: string | undefined;
    const textFieldId = generateFieldId();

    try {
      const table = await createTable(baseId, {
        name: 'formula-datetime-parse-basic',
        fields: [
          { id: textFieldId, name: 'TextDate', type: FieldType.SingleLineText },
          {
            name: 'ParsedDate',
            type: FieldType.Formula,
            options: {
              expression: `DATETIME_PARSE({${textFieldId}})`,
              timeZone: 'Asia/Shanghai',
            },
          },
        ],
      });
      tableId = table.id;

      const formulaFieldId =
        table.fields.find((f) => f.name === 'ParsedDate')?.id ??
        (() => {
          throw new Error('ParsedDate field not found');
        })();

      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { TextDate: '2024-06-15' } }],
      });

      const record = await getRecord(tableId, records[0].id);
      const formulaValue = record.fields?.[formulaFieldId as string];

      expect(formulaValue).not.toBeNull();
      expect(formulaValue).not.toBeUndefined();
      expect(new Date(formulaValue as string).toISOString()).toBe('2024-06-15T00:00:00.000Z');
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });

  /**
   * Test DATETIME_PARSE with single-digit month format.
   * This test verifies that single-digit months are correctly parsed.
   */
  it('parses single-digit month format correctly', async () => {
    let tableId: string | undefined;
    const singleDigitFieldId = generateFieldId();
    const doubleDigitFieldId = generateFieldId();

    try {
      const table = await createTable(baseId, {
        name: 'formula-datetime-parse-format-compare',
        fields: [
          { id: singleDigitFieldId, name: 'SingleDigitDate', type: FieldType.SingleLineText },
          { id: doubleDigitFieldId, name: 'DoubleDigitDate', type: FieldType.SingleLineText },
          {
            name: 'ParsedSingle',
            type: FieldType.Formula,
            options: {
              expression: `DATETIME_PARSE({${singleDigitFieldId}})`,
              timeZone: 'Asia/Shanghai',
            },
          },
          {
            name: 'ParsedDouble',
            type: FieldType.Formula,
            options: {
              expression: `DATETIME_PARSE({${doubleDigitFieldId}})`,
              timeZone: 'Asia/Shanghai',
            },
          },
        ],
      });
      tableId = table.id;

      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [
          {
            fields: {
              SingleDigitDate: '2026-9-15', // Single digit month
              DoubleDigitDate: '2026-09-15', // Double digit month
            },
          },
        ],
      });

      const record = await getRecord(tableId, records[0].id);

      const parsedSingleField = table.fields.find((f) => f.name === 'ParsedSingle')!;
      const parsedDoubleField = table.fields.find((f) => f.name === 'ParsedDouble')!;

      // Double digit format should work
      const parsedDouble = record.fields?.[parsedDoubleField.id];
      expect(parsedDouble).not.toBeNull();
      expect(parsedDouble).not.toBeUndefined();

      // Single digit format should also work
      const parsedSingle = record.fields?.[parsedSingleField.id];
      expect(parsedSingle).not.toBeNull();
      expect(parsedSingle).not.toBeUndefined();
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });

  /**
   * Test DATETIME_PARSE with YEAR/MONTH/DAY concatenation.
   * This test verifies the real-world scenario where MONTH() returns single-digit values.
   */
  it('DATETIME_PARSE with MONTH/DAY concatenation works', async () => {
    let tableId: string | undefined;
    const dateFieldId = generateFieldId();

    try {
      const table = await createTable(baseId, {
        name: 'formula-datetime-parse-concat',
        fields: [
          { id: dateFieldId, name: 'Date', type: FieldType.Date },
          {
            name: 'ConcatFormula',
            type: FieldType.Formula,
            options: {
              expression: `YEAR(TODAY()) & "-" & MONTH({${dateFieldId}}) & "-" & DAY({${dateFieldId}})`,
              timeZone: 'Asia/Shanghai',
            },
          },
          {
            name: 'ParsedDate',
            type: FieldType.Formula,
            options: {
              expression: `DATETIME_PARSE(YEAR(TODAY()) & "-" & MONTH({${dateFieldId}}) & "-" & DAY({${dateFieldId}}))`,
              timeZone: 'Asia/Shanghai',
            },
          },
        ],
      });
      tableId = table.id;

      // September 15 will generate "2026-9-15" (single digit month)
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { Date: '2025-09-15T09:47:06.000Z' } }],
      });

      const record = await getRecord(tableId, records[0].id);

      const concatField = table.fields.find((f) => f.name === 'ConcatFormula')!;
      const parsedField = table.fields.find((f) => f.name === 'ParsedDate')!;

      // ConcatFormula should produce "2026-9-15"
      const concatValue = record.fields?.[concatField.id];
      expect(concatValue).toMatch(/^\d{4}-9-15$/); // e.g., "2026-9-15"

      // ParsedDate should parse the single-digit format correctly
      const parsedValue = record.fields?.[parsedField.id];
      expect(parsedValue).not.toBeNull();
      expect(parsedValue).not.toBeUndefined();
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });

  /**
   * Test formula update with double-digit months (this should work in v1).
   * Uses December (month 12) which doesn't have the single-digit issue.
   */
  it('updates DATETIME_PARSE formula when date field changes (double-digit month)', async () => {
    let tableId: string | undefined;
    const dateFieldId = generateFieldId();

    try {
      const table = await createTable(baseId, {
        name: 'formula-datetime-parse-update-double',
        fields: [
          { id: dateFieldId, name: 'Date', type: FieldType.Date },
          {
            name: 'ParsedDate',
            type: FieldType.Formula,
            options: {
              // Use a formula that always produces zero-padded format
              expression: `DATETIME_PARSE(YEAR(TODAY()) & "-12-" & DAY({${dateFieldId}}))`,
              timeZone: 'Asia/Shanghai',
            },
          },
        ],
      });
      tableId = table.id;

      const formulaFieldId =
        table.fields.find((f) => f.name === 'ParsedDate')?.id ??
        (() => {
          throw new Error('ParsedDate field not found');
        })();

      // Create record with initial date
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { Date: '2025-12-15T09:47:06.000Z' } }],
      });

      // Verify formula computed correctly after creation
      const recordAfterCreate = await getRecord(tableId, records[0].id);
      const formulaValueAfterCreate = recordAfterCreate.fields?.[formulaFieldId as string];

      expect(formulaValueAfterCreate).not.toBeNull();
      expect(formulaValueAfterCreate).not.toBeUndefined();

      // Verify the parsed date contains day 15
      const parsedAfterCreate = new Date(formulaValueAfterCreate as string);
      expect(parsedAfterCreate.getUTCDate()).toBe(15);

      // Update the date to change the day
      await updateRecordByApi(tableId, records[0].id, dateFieldId, '2025-12-28T09:48:15.000Z');

      // Verify formula recalculated correctly after update
      const recordAfterUpdate = await getRecord(tableId, records[0].id);
      const formulaValueAfterUpdate = recordAfterUpdate.fields?.[formulaFieldId as string];

      expect(formulaValueAfterUpdate).not.toBeNull();
      expect(formulaValueAfterUpdate).not.toBeUndefined();

      // Verify the parsed date now contains day 28
      const parsedAfterUpdate = new Date(formulaValueAfterUpdate as string);
      expect(parsedAfterUpdate.getUTCDate()).toBe(28);
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });
});
