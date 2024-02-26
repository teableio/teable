/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { ICreateBaseVo } from '@teable/openapi';
import { createBase, deleteBase, duplicateBase, getTableList } from '@teable/openapi';
import { createTable, getRecords, initApp, updateRecord } from './utils/init-app';

describe('OpenAPI Base Duplicate (e2e)', () => {
  let app: INestApplication;
  let base: ICreateBaseVo;
  const spaceId = globalThis.testConfig.spaceId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    base = (await createBase({ spaceId, name: 'test base' })).data;
  });

  afterEach(async () => {
    await deleteBase(base.id);
  });

  it('duplicate within current space', async () => {
    const table1 = await createTable(base.id, { name: 'table1' });
    const dupResult = await duplicateBase(base.id, { toSpaceId: spaceId, name: 'test base copy' });

    const getResult = await getTableList(dupResult.data.baseId);
    const records = await getRecords(getResult.data[0].id);
    expect(records.records.length).toBe(0);

    expect(getResult.data.length).toBe(1);
    expect(getResult.data[0].name).toBe(table1.name);
    expect(getResult.data[0].id).not.toBe(table1.id);
  });

  it('duplicate with records', async () => {
    const table1 = await createTable(base.id, { name: 'table1' });
    const preRecords = await getRecords(table1.id);
    await updateRecord(table1.id, preRecords.records[0].id, {
      record: { fields: { [table1.fields[0].name]: 'new value' } },
    });

    const dupResult = await duplicateBase(base.id, {
      toSpaceId: spaceId,
      name: 'test base copy',
      withRecords: true,
    });

    const getResult = await getTableList(dupResult.data.baseId);

    const records = await getRecords(getResult.data[0].id);
    expect(records.records[0].lastModifiedBy).toBeFalsy();
    expect(records.records.length).toBe(3);
  });
});
