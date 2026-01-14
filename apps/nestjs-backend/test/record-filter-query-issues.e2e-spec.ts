/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFilter } from '@teable/core';
import {
  and,
  DateFormattingPreset,
  exactFormatDate,
  FieldKeyType,
  FieldType,
  isAfter,
  TimeFormatting,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords as apiGetRecords } from '@teable/openapi';
import { createTable, permanentDeleteTable, initApp } from './utils/init-app';

describe('OpenAPI Record-Filter-Query Issues (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  async function getFilterRecord(tableId: string, viewId: string, filter: IFilter) {
    return (
      await apiGetRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        filter: filter,
      })
    ).data;
  }

  describe('filter date field with minute precision', () => {
    let table: ITableFullVo;
    const tz = 'Asia/Singapore';
    const dateFieldName = 'dateFieldWithTime';

    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'date_minute_precision',
        fields: [
          {
            name: dateFieldName,
            type: FieldType.Date,
            options: {
              formatting: {
                date: DateFormattingPreset.ISO,
                time: TimeFormatting.Hour24,
                timeZone: tz,
              },
            },
          },
        ],
        records: [
          // Record with time 23:37:00 (stored as UTC: 15:37:00 for Asia/Singapore +8)
          { fields: { [dateFieldName]: '2026-01-08T15:37:00.000Z' } },
          // Record with time 23:35:00
          { fields: { [dateFieldName]: '2026-01-08T15:35:00.000Z' } },
          // Record with time 23:38:00
          { fields: { [dateFieldName]: '2026-01-08T15:38:00.000Z' } },
        ],
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should filter records with isAfter operator using minute precision (exactFormatDate)', async () => {
      const tableId = table.id;
      const viewId = table.views[0].id;
      const fieldId = table.fields[0].id;

      // Filter: isAfter 2026-01-08 23:36 (in Asia/Singapore timezone)
      // Expected: should return records with time 23:37 and 23:38, but NOT 23:35
      const filter: IFilter = {
        filterSet: [
          {
            fieldId: fieldId,
            operator: isAfter.value,
            value: {
              mode: exactFormatDate.value,
              // 23:36:00 in Asia/Singapore = 15:36:00 UTC
              exactDate: '2026-01-08T15:36:00.000Z',
              timeZone: tz,
            },
          },
        ],
        conjunction: and.value,
      };

      const { records } = await getFilterRecord(tableId, viewId!, filter);
      // Should find 2 records: 23:37 and 23:38
      expect(records.length).toBe(2);
    });
  });
});
