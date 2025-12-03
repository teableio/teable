import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, generateFieldId } from '@teable/core';
import {
  createRecords,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('Formula DATETIME_FORMAT token semantics (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('treats HH as 24-hour clock and mm as minutes like Airtable', async () => {
    let tableId: string | undefined;
    const dateFieldId = generateFieldId();

    try {
      const table = await createTable(baseId, {
        name: 'formula-datetime-format-24h',
        fields: [
          { id: dateFieldId, name: 'event_time', type: FieldType.Date },
          {
            name: 'formatted_24h',
            type: FieldType.Formula,
            options: {
              expression: `DATETIME_FORMAT({${dateFieldId}}, 'YYYY-MM-DD HH:mm:ss')`,
              timeZone: 'UTC',
            },
          },
        ],
      });
      tableId = table.id;

      const formattedFieldId =
        table.fields.find((f) => f.name === 'formatted_24h')?.id ??
        (() => {
          throw new Error('formatted_24h field not found');
        })();
      const input = '2024-12-03T09:07:11.000Z';
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { event_time: input } }],
      });

      const record = await getRecord(tableId, records[0].id);
      const fields = record.fields;
      expect(fields?.[formattedFieldId as string]).toBe('2024-12-03 09:07:11');
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });

  it('defaults DATETIME_FORMAT to an ISO-like pattern when the format is omitted', async () => {
    let tableId: string | undefined;
    const dateFieldId = generateFieldId();

    try {
      const table = await createTable(baseId, {
        name: 'formula-datetime-format-default',
        fields: [
          { id: dateFieldId, name: 'handover_time', type: FieldType.Date },
          {
            name: 'handover_year',
            type: FieldType.Formula,
            options: {
              expression: `LEFT(DATETIME_FORMAT({${dateFieldId}}), 4)`,
              timeZone: 'Asia/Shanghai',
            },
          },
        ],
      });
      tableId = table.id;

      const formulaFieldId =
        table.fields.find((f) => f.name === 'handover_year')?.id ??
        (() => {
          throw new Error('handover_year field not found');
        })();

      const input = '2024-10-10T16:00:00.000Z';
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { handover_time: input } }],
      });

      const record = await getRecord(tableId, records[0].id);
      const value = record.fields?.[formulaFieldId as string];
      expect(value).toBe('2024');
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });

  it('keeps hh with A as a 12-hour clock while mm stays minutes', async () => {
    let tableId: string | undefined;
    const dateFieldId = generateFieldId();

    try {
      const table = await createTable(baseId, {
        name: 'formula-datetime-format-12h',
        fields: [
          { id: dateFieldId, name: 'planned_time', type: FieldType.Date },
          {
            name: 'formatted_12h',
            type: FieldType.Formula,
            options: {
              expression: `DATETIME_FORMAT({${dateFieldId}}, 'YYYY-MM-DD hh:mm A')`,
              timeZone: 'UTC',
            },
          },
        ],
      });
      tableId = table.id;

      const formattedFieldId =
        table.fields.find((f) => f.name === 'formatted_12h')?.id ??
        (() => {
          throw new Error('formatted_12h field not found');
        })();
      const input = '2024-05-06T15:04:05.000Z';
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
        records: [{ fields: { planned_time: input } }],
      });

      const record = await getRecord(tableId, records[0].id);
      const fields = record.fields;
      expect(fields?.[formattedFieldId as string]).toBe('2024-05-06 03:04 PM');
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });

  it('returns null instead of throwing when formatting non-datetime text', async () => {
    let tableId: string | undefined;
    const textFieldId = generateFieldId();

    try {
      const table = await createTable(baseId, {
        name: 'formula-datetime-format-invalid-text',
        fields: [
          { id: textFieldId, name: 'raw_text', type: FieldType.SingleLineText },
          {
            name: 'formatted_invalid',
            type: FieldType.Formula,
            options: {
              expression: `DATETIME_FORMAT({${textFieldId}}, 'YYYY-MM-DD HH:mm')`,
              timeZone: 'Asia/Shanghai',
            },
          },
        ],
      });
      tableId = table.id;

      const formattedFieldId =
        table.fields.find((f) => f.name === 'formatted_invalid')?.id ??
        (() => {
          throw new Error('formatted_invalid field not found');
        })();

      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { raw_text: '2' } }],
      });

      const record = await getRecord(tableId, records[0].id);
      const fields = record.fields;
      const value = fields?.[formattedFieldId as string];
      expect(value ?? null).toBeNull();
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });
});
