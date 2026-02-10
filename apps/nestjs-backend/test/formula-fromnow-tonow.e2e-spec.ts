import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, generateFieldId } from '@teable/core';
import {
  createRecords,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  expect(Number.isFinite(parsed)).toBe(true);
  return parsed;
};

const FLOAT_COMPARISON_TOLERANCE = 1e-9;

describe('Formula FROMNOW / TONOW (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('supports unit conversion and keeps TONOW past-positive semantics', async () => {
    let tableId: string | undefined;
    const dateFieldId = generateFieldId();

    try {
      const table = await createTable(baseId, {
        name: `formula-fromnow-tonow-${Date.now()}`,
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { id: dateFieldId, name: 'EventTime', type: FieldType.Date },
          {
            name: 'FROMNOW_day',
            type: FieldType.Formula,
            options: {
              expression: `FROMNOW({${dateFieldId}}, 'day')`,
            },
          },
          {
            name: 'FROMNOW_hour',
            type: FieldType.Formula,
            options: {
              expression: `FROMNOW({${dateFieldId}}, 'hour')`,
            },
          },
          {
            name: 'FROMNOW_second',
            type: FieldType.Formula,
            options: {
              expression: `FROMNOW({${dateFieldId}}, 'second')`,
            },
          },
          {
            name: 'TONOW_day',
            type: FieldType.Formula,
            options: {
              expression: `TONOW({${dateFieldId}}, 'day')`,
            },
          },
        ],
      });
      tableId = table.id;

      const fromNowDayId = table.fields.find((f) => f.name === 'FROMNOW_day')?.id;
      const fromNowHourId = table.fields.find((f) => f.name === 'FROMNOW_hour')?.id;
      const fromNowSecondId = table.fields.find((f) => f.name === 'FROMNOW_second')?.id;
      const toNowDayId = table.fields.find((f) => f.name === 'TONOW_day')?.id;

      expect(fromNowDayId).toBeTruthy();
      expect(fromNowHourId).toBeTruthy();
      expect(fromNowSecondId).toBeTruthy();
      expect(toNowDayId).toBeTruthy();

      const now = Date.now();
      const pastDate = new Date(now - (3 * 24 + 2) * 60 * 60 * 1000).toISOString();
      const futureDate = new Date(now + (2 * 24 + 1) * 60 * 60 * 1000).toISOString();

      const pastCreate = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { Name: 'past', EventTime: pastDate } }],
      });
      const futureCreate = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { Name: 'future', EventTime: futureDate } }],
      });

      const pastRecord = await getRecord(tableId, pastCreate.records[0].id);
      const futureRecord = await getRecord(tableId, futureCreate.records[0].id);

      const pastDay = toNumber(pastRecord.fields?.[fromNowDayId as string]);
      const pastHour = toNumber(pastRecord.fields?.[fromNowHourId as string]);
      const pastSecond = toNumber(pastRecord.fields?.[fromNowSecondId as string]);
      const pastToNow = toNumber(pastRecord.fields?.[toNowDayId as string]);

      expect(pastDay).toBeGreaterThan(0);
      expect(pastToNow).toBeGreaterThan(0);
      expect(Math.abs(pastDay - pastToNow)).toBeLessThanOrEqual(1);

      expect(pastHour + FLOAT_COMPARISON_TOLERANCE).toBeGreaterThanOrEqual(pastDay * 24);
      expect(pastHour).toBeLessThan((pastDay + 1) * 24 + FLOAT_COMPARISON_TOLERANCE);
      expect(pastSecond + FLOAT_COMPARISON_TOLERANCE).toBeGreaterThanOrEqual(pastHour * 3600);
      expect(pastSecond).toBeLessThan((pastHour + 1) * 3600 + FLOAT_COMPARISON_TOLERANCE);

      const futureToNow = toNumber(futureRecord.fields?.[toNowDayId as string]);
      expect(futureToNow).toBeLessThan(0);
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });
});
