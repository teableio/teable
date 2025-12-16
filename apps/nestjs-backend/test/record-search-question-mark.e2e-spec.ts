import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { getRecords as apiGetRecords } from '@teable/openapi';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('Record search with question mark (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let tableId: string | undefined;
  let viewId: string | undefined;
  let urlFieldId: string | undefined;

  const urlField = { name: 'url', type: FieldType.SingleLineText };
  const urlWithQuestionMark = 'https://example.com/path?param=value';

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const table = await createTable(baseId, {
      name: `record_search_question_mark_${Date.now()}`,
      fields: [urlField],
      records: [
        { fields: { [urlField.name]: urlWithQuestionMark } },
        { fields: { [urlField.name]: 'https://example.com/other' } },
      ],
    });

    tableId = table.id;
    viewId = table.views?.[0]?.id;
    urlFieldId = table.fields?.find((f) => f.name === urlField.name)?.id;
  });

  afterAll(async () => {
    if (tableId) {
      await permanentDeleteTable(baseId, tableId);
    }
    await app.close();
  });

  it('should search url containing "?" without failing', async () => {
    const res = await apiGetRecords(tableId!, {
      viewId,
      take: 300,
      skip: 0,
      search: [urlWithQuestionMark, '', true],
    });

    expect(res.status).toBe(200);
    expect(res.data.records).toHaveLength(1);
    expect(res.data.extra?.searchHitIndex).toEqual([
      { fieldId: urlFieldId, recordId: res.data.records[0].id },
    ]);
  });
});
