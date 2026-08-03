import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import type { IRecordsVo } from '@teable/openapi';
import {
  createBase,
  createField,
  createRecords,
  createTable,
  deleteBase,
  getRecord,
  getRecords,
  initApp,
  updateRecord,
} from './utils/init-app';

describe('Audit user fields (API only)', () => {
  let app: INestApplication;
  const spaceId = globalThis.testConfig.spaceId;
  const userName = globalThis.testConfig.userName;
  const userEmail = globalThis.testConfig.email;
  let baseId: string;

  const basicFields: IFieldRo[] = [
    {
      name: 'Title',
      type: FieldType.SingleLineText,
    },
  ];

  const getRecordById = (records: IRecordsVo['records'], id: string) =>
    records.find((r) => r.id === id);

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    const base = await createBase({ name: 'audit-user', spaceId });
    baseId = base.id;
  });

  afterAll(async () => {
    await deleteBase(baseId);
    await app.close();
  });

  it('populates CreatedBy on new records', async () => {
    const table = await createTable(baseId, { name: 'audit-created', fields: basicFields });
    const titleFieldId = table.fields?.find((f) => f.name === 'Title')?.id as string;
    const createdByField = await createField(table.id, { type: FieldType.CreatedBy });

    const { records: createdRecords } = await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [titleFieldId]: 'alpha',
          },
        },
      ],
    });

    const createdId = createdRecords[0].id;
    const list = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    const target = getRecordById(list.records, createdId);

    expect(target?.fields[createdByField.id]).toMatchObject({
      id: globalThis.testConfig.userId,
      title: userName,
      email: userEmail,
    });
  });

  it('updates LastModifiedBy and formulas referencing CreatedBy return the user name', async () => {
    const table = await createTable(baseId, { name: 'audit-last-mod', fields: basicFields });
    const titleFieldId = table.fields?.find((f) => f.name === 'Title')?.id as string;
    const createdByField = await createField(table.id, { type: FieldType.CreatedBy });
    const lastModifiedByField = await createField(table.id, { type: FieldType.LastModifiedBy });

    const { records: createdRecords } = await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [titleFieldId]: 'first',
          },
        },
      ],
    });
    const recordId = createdRecords[0].id;

    await updateRecord(table.id, recordId, {
      record: {
        fields: {
          [titleFieldId]: 'updated',
        },
      },
      fieldKeyType: FieldKeyType.Id,
    });

    const updatedJson = await getRecord(table.id, recordId);

    expect(updatedJson.fields[createdByField.id]).toMatchObject({
      title: userName,
      email: userEmail,
    });
    expect(updatedJson.fields[lastModifiedByField.id]).toMatchObject({
      title: userName,
      email: userEmail,
    });
  });

  it('supports searching on user audit fields', async () => {
    const table = await createTable(baseId, { name: 'audit-search', fields: basicFields });
    const titleFieldId = table.fields?.find((f) => f.name === 'Title')?.id as string;
    const createdByField = await createField(table.id, { type: FieldType.CreatedBy });

    const { records: createdRecords } = await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [titleFieldId]: 'search-me',
          },
        },
      ],
    });
    const recordId = createdRecords[0].id;

    const searchRes = await getRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      search: [userName, createdByField.id],
    });

    expect(searchRes.records.map((r) => r.id)).toContain(recordId);
  });
});
