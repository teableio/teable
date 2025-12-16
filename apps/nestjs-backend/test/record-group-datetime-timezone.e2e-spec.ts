import type { INestApplication } from '@nestjs/common';
import {
  DateFormattingPreset,
  FieldKeyType,
  FieldType,
  SortFunc,
  TimeFormatting,
  formatDateToString,
} from '@teable/core';
import { GroupPointType } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import { createTable, getRecords, initApp, permanentDeleteTable } from './utils/init-app';

describe('OpenAPI Record-Group-DateTime-TimeZone (e2e)', async () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should keep groupPoints datetime consistent when field timeZone differs from system', async () => {
    const table: ITableFullVo = await createTable(baseId, {
      name: 'record_group_datetime_timezone',
      fields: [
        {
          name: 'id',
          type: FieldType.SingleLineText,
        },
        {
          name: 'dt',
          type: FieldType.Date,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.Hour24,
              timeZone: 'UTC',
            },
          },
        },
      ],
      records: [
        {
          fields: {
            id: '1',
            dt: '2025-12-15T11:00:00.000Z',
          },
        },
      ],
    });

    try {
      const dateField = table.fields.find((f) => f.name === 'dt');
      expect(dateField?.id).toBeTruthy();

      const res = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        groupBy: [{ fieldId: dateField!.id, order: SortFunc.Asc }],
      });

      const recordValue = res.records?.[0]?.fields?.[dateField!.id] as string | undefined;
      expect(recordValue).toBeTruthy();

      const groupHeader = res.extra?.groupPoints?.find(
        (p) => p.type === GroupPointType.Header && (p as { depth?: number }).depth === 0
      ) as { value?: unknown } | undefined;
      expect(groupHeader?.value).toBeTruthy();

      const formatting = {
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.Hour24,
        timeZone: 'UTC',
      };

      expect(formatDateToString(groupHeader!.value as string, formatting)).toBe(
        formatDateToString(recordValue!, formatting)
      );
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
