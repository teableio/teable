import type { INestApplication } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import { getRecords as apiGetRecords } from '@teable/openapi';
import { x_20 } from './data-helpers/20x';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

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

describe('Record filter isWithIn today (e2e)', () => {
  let tableId: string;
  let dateFieldId: string;

  beforeAll(async () => {
    const table = await createTable(baseId, {
      name: 'record_query_is_with_in_today',
      fields: x_20.fields,
      records: x_20.records,
    });
    tableId = table.id;
    dateFieldId = table.fields[3].id;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  const queryTodayFilter = async () => {
    const result = await apiGetRecords(tableId, {
      fieldKeyType: FieldKeyType.Name,
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dateFieldId,
            operator: 'isWithIn',
            value: {
              mode: 'today',
              timeZone: 'Asia/Singapore',
            },
          },
        ],
      },
    });

    return result.data.records.map((record) => record.fields['text field']);
  };

  it('matches the current day on the legacy path', async () => {
    await expect(queryTodayFilter()).resolves.toEqual(['Text Field 20']);
  });

  it('matches the current day on the force-v2 compatibility path', async () => {
    await withForceV2All(async () => {
      await expect(queryTodayFilter()).resolves.toEqual(['Text Field 20']);
    });
  });
});
