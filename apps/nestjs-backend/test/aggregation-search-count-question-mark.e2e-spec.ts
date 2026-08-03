import type { INestApplication } from '@nestjs/common';
import { FieldType, NumberFormattingType } from '@teable/core';
import { getSearchCount as apiGetSearchCount } from '@teable/openapi';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('Aggregation search count with question mark (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let tableId: string | undefined;
  let numberFieldId: string | undefined;

  const urlField1 = { name: 'url1', type: FieldType.SingleLineText };
  const urlField2 = { name: 'url2', type: FieldType.SingleLineText };
  const numberField = {
    name: 'num',
    type: FieldType.Number,
    options: {
      formatting: { type: NumberFormattingType.Decimal, precision: 1 },
    },
  };

  const urlWithQuestionMark = 'https://example.com/path?param=value';

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const table = await createTable(baseId, {
      name: `search_count_question_mark_${Date.now()}`,
      fields: [urlField1, urlField2, numberField],
      records: [
        { fields: { [urlField1.name]: urlWithQuestionMark, [urlField2.name]: 'no', num: 10.1 } },
        { fields: { [urlField1.name]: 'no', [urlField2.name]: urlWithQuestionMark, num: 20.2 } },
        { fields: { [urlField1.name]: 'no', [urlField2.name]: 'no', num: 30.3 } },
      ],
    });

    tableId = table.id;
    numberFieldId = table.fields?.find((f) => f.name === numberField.name)?.id;
  });

  afterAll(async () => {
    if (tableId) {
      await permanentDeleteTable(baseId, tableId);
    }
    await app.close();
  });

  it('should return count without failing when search contains "?"', async () => {
    const res = await apiGetSearchCount(tableId!, {
      search: [urlWithQuestionMark, '', true],
    });

    expect(res.status).toBe(200);
    expect(res.data.count).toBe(2);
  });

  it('should support number precision bindings', async () => {
    const res = await apiGetSearchCount(tableId!, {
      search: ['10', numberFieldId!, true],
    });

    expect(res.status).toBe(200);
    expect(res.data.count).toBe(1);
  });
});
