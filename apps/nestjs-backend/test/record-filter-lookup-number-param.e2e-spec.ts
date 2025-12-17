import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship, and, is, isGreater } from '@teable/core';
import { createField, getRecords as apiGetRecords } from '@teable/openapi';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('Record filter lookup multiple-number bindings (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  let foreignTableId: string | undefined;
  let mainTableId: string | undefined;
  let linkFieldId: string | undefined;
  let foreignNumberFieldId: string | undefined;
  let lookupNumberFieldId: string | undefined;

  const foreignNumberFieldName = 'num';
  const linkFieldName = 'links';

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const foreign = await createTable(baseId, {
      name: `lookup_num_foreign_${Date.now()}`,
      fields: [{ name: foreignNumberFieldName, type: FieldType.Number }],
      records: [
        { fields: { [foreignNumberFieldName]: 9 } },
        { fields: { [foreignNumberFieldName]: 11 } },
        { fields: { [foreignNumberFieldName]: 1 } },
      ],
    });
    foreignTableId = foreign.id;
    foreignNumberFieldId = foreign.fields?.find((f) => f.name === foreignNumberFieldName)?.id;
    if (!foreignTableId) throw new Error('foreignTableId not found');
    if (!foreignNumberFieldId) throw new Error('foreignNumberFieldId not found');

    const foreign9 = foreign.records?.[0]?.id;
    const foreign11 = foreign.records?.[1]?.id;
    const foreign1 = foreign.records?.[2]?.id;
    if (!foreign9 || !foreign11 || !foreign1) throw new Error('foreign records not found');

    const main = await createTable(baseId, {
      name: `lookup_num_main_${Date.now()}`,
      fields: [
        { name: 'name', type: FieldType.SingleLineText },
        {
          name: linkFieldName,
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreignTableId,
            isOneWay: false,
          },
        },
      ],
      records: [
        {
          fields: {
            name: 'a',
            [linkFieldName]: [{ id: foreign9 }, { id: foreign11 }],
          },
        },
        {
          fields: {
            name: 'b',
            [linkFieldName]: [{ id: foreign9 }],
          },
        },
        {
          fields: {
            name: 'c',
            [linkFieldName]: [{ id: foreign1 }],
          },
        },
        {
          fields: {
            name: 'd',
          },
        },
      ],
    });
    mainTableId = main.id;
    linkFieldId = main.fields?.find((f) => f.name === linkFieldName)?.id;
    if (!mainTableId) throw new Error('mainTableId not found');
    if (!linkFieldId) throw new Error('linkFieldId not found');

    const lookupFieldRes = await createField(mainTableId, {
      name: 'lookup_num',
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        foreignTableId: foreignTableId,
        lookupFieldId: foreignNumberFieldId,
        linkFieldId: linkFieldId,
      },
    });
    lookupNumberFieldId = lookupFieldRes.data.id;
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

  it('filters lookup number array with `is`', async () => {
    const res = await apiGetRecords(mainTableId!, {
      fieldKeyType: FieldKeyType.Id,
      filter: {
        conjunction: and.value,
        filterSet: [{ fieldId: lookupNumberFieldId!, operator: is.value, value: 9 }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.data.records).toHaveLength(2);
  });

  it('filters lookup number array with `isGreater`', async () => {
    const res = await apiGetRecords(mainTableId!, {
      fieldKeyType: FieldKeyType.Id,
      filter: {
        conjunction: and.value,
        filterSet: [{ fieldId: lookupNumberFieldId!, operator: isGreater.value, value: 10 }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.data.records).toHaveLength(1);
  });
});
