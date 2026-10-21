/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { getRecords as apiGetRecords } from '@teable/openapi';
import { initApp, createTable, permanentDeleteTable } from './utils/init-app';

let app: INestApplication;
const baseId = globalThis.testConfig.baseId;

const withForceV2All = async <T>(callback: () => Promise<T>) => {
  const previousForceV2All = process.env.FORCE_V2_ALL;
  process.env.FORCE_V2_ALL = 'true';
  try {
    return await callback();
  } finally {
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
  }
};

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
});

afterAll(async () => {
  await app.close();
});

describe('Record filterByTql empty-string date comparison (e2e)', () => {
  let tableId: string;
  let dateFieldName: string;

  beforeAll(async () => {
    const table = await createTable(baseId, {
      name: 'record_query_tql_empty_date',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Due Date', type: FieldType.Date },
      ],
      records: [
        { fields: { Name: 'with-date', 'Due Date': '2026-09-30T12:00:00.000Z' } },
        { fields: { Name: 'without-date' } },
      ],
    });
    tableId = table.id;
    dateFieldName = table.fields.find((field) => field.name === 'Due Date')?.name ?? 'Due Date';
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, tableId);
  });
  const expectTqlNames = async (filterByTql: string, expectedNames: string[]) => {
    const result = await apiGetRecords(tableId, {
      fieldKeyType: FieldKeyType.Name,
      filterByTql,
    });

    expect(result.data.records.map((record) => record.fields.Name).sort()).toEqual(expectedNames);
  };

  it('treats {date} != "" as isNotEmpty on the force-v2 compatibility path', async () => {
    await withForceV2All(async () => {
      await expectTqlNames(`{${dateFieldName}} != ""`, ['with-date']);
    });
  });

  it('treats {date} = "" as isEmpty on the force-v2 compatibility path', async () => {
    await withForceV2All(async () => {
      await expectTqlNames(`{${dateFieldName}} = ""`, ['without-date']);
    });
  });
});
