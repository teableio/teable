/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import {
  createField,
  createRecords,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  convertField,
} from './utils/init-app';

describe('Formula field timezone modification (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should preserve formula values when changing timezone option', async () => {
    let tableId: string | undefined;

    try {
      // Create table with a date field
      const table = await createTable(baseId, {
        name: 'formula-timezone-convert-test',
      });
      tableId = table.id;

      // Create a date field
      const dateField = await createField(tableId, {
        name: 'event_date',
        type: FieldType.Date,
      });

      // Create a formula field that formats the date
      const formulaField = await createField(tableId, {
        name: 'formatted_date',
        type: FieldType.Formula,
        options: {
          expression: `DATETIME_FORMAT({${dateField.id}}, 'YYYY-MM-DD HH:mm:ss')`,
          timeZone: 'UTC',
        },
      });

      // Create a record with a date value
      const input = '2024-12-03T09:07:11.000Z';
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { event_date: input } }],
      });

      // Verify the formula field has a value
      const recordBefore = await getRecord(tableId, records[0].id);
      const valueBefore = recordBefore.fields?.[formulaField.id];
      expect(valueBefore).toBe('2024-12-03 09:07:11');

      // Change the timezone option
      await convertField(tableId, formulaField.id, {
        type: FieldType.Formula,
        options: {
          expression: `DATETIME_FORMAT({${dateField.id}}, 'YYYY-MM-DD HH:mm:ss')`,
          timeZone: 'Asia/Shanghai',
        },
      });

      // Verify the formula field still has a value (not cleared)
      // The value should change due to timezone conversion (+8 hours)
      const recordAfter = await getRecord(tableId, records[0].id);
      const valueAfter = recordAfter.fields?.[formulaField.id];
      // Asia/Shanghai is UTC+8, so 09:07:11 UTC becomes 17:07:11 Shanghai time
      expect(valueAfter).toBe('2024-12-03 17:07:11');
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });

  it('should preserve formula values when changing formatting option', async () => {
    let tableId: string | undefined;

    try {
      // Create table with a number field
      const table = await createTable(baseId, {
        name: 'formula-formatting-convert-test',
      });
      tableId = table.id;

      // Create a number field
      const numberField = await createField(tableId, {
        name: 'amount',
        type: FieldType.Number,
      });

      // Create a formula field
      const formulaField = await createField(tableId, {
        name: 'doubled_amount',
        type: FieldType.Formula,
        options: {
          expression: `{${numberField.id}} * 2`,
        },
      });

      // Create a record with a number value
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { amount: 100 } }],
      });

      // Verify the formula field has a value
      const recordBefore = await getRecord(tableId, records[0].id);
      const valueBefore = recordBefore.fields?.[formulaField.id];
      expect(valueBefore).toBe(200);

      // Change the formatting option
      await convertField(tableId, formulaField.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${numberField.id}} * 2`,
          formatting: {
            type: 'decimal',
            precision: 2,
          },
        },
      });

      // Verify the formula field still has its value
      const recordAfter = await getRecord(tableId, records[0].id);
      const valueAfter = recordAfter.fields?.[formulaField.id];
      expect(valueAfter).toBe(200);
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });

  it('should preserve formula values when formula directly references date field and timezone changes', async () => {
    let tableId: string | undefined;

    try {
      // Create table with a date field
      const table = await createTable(baseId, {
        name: 'formula-direct-date-ref-test',
      });
      tableId = table.id;

      // Create a date field
      const dateField = await createField(tableId, {
        name: 'event_date',
        type: FieldType.Date,
      });

      // Create a formula field that directly references the date (returns DateTime cellValueType)
      const formulaField = await createField(tableId, {
        name: 'date_ref',
        type: FieldType.Formula,
        options: {
          expression: `{${dateField.id}}`,
          timeZone: 'UTC',
        },
      });

      // Create a record with a date value
      const input = '2024-12-03T09:07:11.000Z';
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { event_date: input } }],
      });

      // Verify the formula field has a value
      const recordBefore = await getRecord(tableId, records[0].id);
      const valueBefore = recordBefore.fields?.[formulaField.id];
      expect(valueBefore).toBe(input);

      // Change the timezone option
      await convertField(tableId, formulaField.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${dateField.id}}`,
          timeZone: 'Asia/Shanghai',
        },
      });

      // Verify the formula field still has its value (should NOT be cleared)
      const recordAfter = await getRecord(tableId, records[0].id);
      const valueAfter = recordAfter.fields?.[formulaField.id];
      // The underlying DateTime value should remain the same ISO string
      expect(valueAfter).toBe(input);
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });

  it('should preserve formula values when only timezone changes (no other option change)', async () => {
    let tableId: string | undefined;

    try {
      // Create table with a date field
      const table = await createTable(baseId, {
        name: 'formula-only-timezone-change-test',
      });
      tableId = table.id;

      // Create a date field
      const dateField = await createField(tableId, {
        name: 'event_date',
        type: FieldType.Date,
      });

      // Create a formula field using YEAR function (affected by timezone)
      const formulaField = await createField(tableId, {
        name: 'event_year',
        type: FieldType.Formula,
        options: {
          expression: `YEAR({${dateField.id}})`,
          timeZone: 'UTC',
        },
      });

      // Create a record with a date value
      const input = '2024-12-31T23:00:00.000Z';
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { event_date: input } }],
      });

      // Verify the formula field has a value (year 2024 in UTC)
      const recordBefore = await getRecord(tableId, records[0].id);
      const valueBefore = recordBefore.fields?.[formulaField.id];
      expect(valueBefore).toBe(2024);

      // Change the timezone to Asia/Shanghai (UTC+8)
      await convertField(tableId, formulaField.id, {
        type: FieldType.Formula,
        options: {
          expression: `YEAR({${dateField.id}})`,
          timeZone: 'Asia/Shanghai',
        },
      });

      // Verify the formula field still has a value (should NOT be null/undefined)
      // In Asia/Shanghai, 2024-12-31T23:00:00.000Z is 2025-01-01 07:00:00
      const recordAfter = await getRecord(tableId, records[0].id);
      const valueAfter = recordAfter.fields?.[formulaField.id];
      expect(valueAfter).toBe(2025);
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });

  it('should preserve formula values when partial options are sent (only timeZone without expression)', async () => {
    let tableId: string | undefined;

    try {
      // Create table with a date field
      const table = await createTable(baseId, {
        name: 'formula-partial-options-test',
      });
      tableId = table.id;

      // Create a date field
      const dateField = await createField(tableId, {
        name: 'event_date',
        type: FieldType.Date,
      });

      // Create a formula field using DATETIME_FORMAT function
      const formulaField = await createField(tableId, {
        name: 'formatted_date',
        type: FieldType.Formula,
        options: {
          expression: `DATETIME_FORMAT({${dateField.id}}, 'YYYY-MM-DD HH:mm:ss')`,
          timeZone: 'UTC',
        },
      });

      // Create a record with a date value
      const input = '2024-06-15T14:30:00.000Z';
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { event_date: input } }],
      });

      // Verify the formula field has a value
      const recordBefore = await getRecord(tableId, records[0].id);
      const valueBefore = recordBefore.fields?.[formulaField.id];
      expect(valueBefore).toBe('2024-06-15 14:30:00');

      // Simulate sending only timeZone option without expression
      // This mimics what the UI does when only changing the timezone
      await convertField(tableId, formulaField.id, {
        type: FieldType.Formula,
        // @ts-expect-error - this is a test
        options: {
          timeZone: 'America/New_York', // Only send timeZone, no expression
        },
      });

      // Verify the formula field still has a value (should NOT be null/undefined)
      // America/New_York is UTC-4 in June (EDT), so 14:30:00 UTC becomes 10:30:00 EDT
      const recordAfter = await getRecord(tableId, records[0].id);
      const valueAfter = recordAfter.fields?.[formulaField.id];
      expect(valueAfter).toBe('2024-06-15 10:30:00');
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });
});
