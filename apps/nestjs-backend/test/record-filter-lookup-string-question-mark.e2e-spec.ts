import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship, and, is } from '@teable/core';
import { getRecords as apiGetRecords } from '@teable/openapi';
import { createField, createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('Record filter lookup string with question mark (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  let foreignTableId: string | undefined;
  let mainTableId: string | undefined;
  let lookupFieldId: string | undefined;

  const valueWithQuestionMark = 'https://example.com/path?param=value';

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const foreign = await createTable(baseId, {
      name: `lookup_str_foreign_${Date.now()}`,
      fields: [{ name: 'url', type: FieldType.SingleLineText }],
      records: [
        { fields: { url: valueWithQuestionMark } },
        { fields: { url: 'https://example.com/other' } },
      ],
    });
    foreignTableId = foreign.id;
    const foreignUrlFieldId = foreign.fields?.find((f) => f.name === 'url')?.id;
    if (!foreignTableId) throw new Error('foreignTableId not found');
    if (!foreignUrlFieldId) throw new Error('foreignUrlFieldId not found');

    const foreignUrlRecordId = foreign.records?.[0]?.id;
    const foreignOtherRecordId = foreign.records?.[1]?.id;
    if (!foreignUrlRecordId || !foreignOtherRecordId) throw new Error('foreign records not found');

    const main = await createTable(baseId, {
      name: `lookup_str_main_${Date.now()}`,
      fields: [
        { name: 'name', type: FieldType.SingleLineText },
        {
          name: 'links',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId,
            isOneWay: false,
          },
        },
      ],
      records: [
        { fields: { name: 'a', links: [{ id: foreignUrlRecordId }] } },
        { fields: { name: 'b', links: [{ id: foreignOtherRecordId }] } },
        {
          fields: { name: 'c', links: [{ id: foreignUrlRecordId }, { id: foreignOtherRecordId }] },
        },
      ],
    });
    mainTableId = main.id;
    const linkFieldId = main.fields?.find((f) => f.name === 'links')?.id;
    if (!mainTableId) throw new Error('mainTableId not found');
    if (!linkFieldId) throw new Error('linkFieldId not found');

    const lookupField = await createField(mainTableId, {
      name: 'lookup_url',
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId,
        lookupFieldId: foreignUrlFieldId,
        linkFieldId,
      },
    });
    lookupFieldId = lookupField.id;
  });

  afterAll(async () => {
    if (mainTableId) {
      await permanentDeleteTable(baseId, mainTableId);
    }
    if (foreignTableId) {
      await permanentDeleteTable(baseId, foreignTableId);
    }
    await app.close();
  });

  it('filters lookup string values containing "?" with `is`', async () => {
    const res = await apiGetRecords(mainTableId!, {
      fieldKeyType: FieldKeyType.Id,
      filter: {
        conjunction: and.value,
        filterSet: [{ fieldId: lookupFieldId!, operator: is.value, value: valueWithQuestionMark }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.data.records).toHaveLength(2);
  });
});
