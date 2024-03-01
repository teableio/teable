/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions, ILookupOptionsRo } from '@teable/core';
import { DriverClient, FieldType, Relationship } from '@teable/core';
import type { ICreateBaseVo, ICreateSpaceVo } from '@teable/openapi';
import {
  createBase,
  createField,
  createSpace,
  deleteBase,
  deleteSpace,
  duplicateBase,
  getBaseList,
  getField,
  getTableList,
} from '@teable/openapi';
import { createRecords, createTable, getRecords, initApp, updateRecord } from './utils/init-app';

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

  if (globalThis.testConfig.driver !== DriverClient.Pg) {
    expect(true).toBeTruthy();
    return;
  }

  it('duplicate within current space', async () => {
    const table1 = await createTable(base.id, { name: 'table1' });
    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
    });

    const getResult = await getTableList(dupResult.data.id);
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

    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
      withRecords: true,
    });

    const getResult = await getTableList(dupResult.data.id);

    const records = await getRecords(getResult.data[0].id);
    expect(records.records[0].lastModifiedBy).toBeFalsy();
    expect(records.records[0].createdTime).toBeTruthy();
    expect(records.records[0].fields[table1.fields[0].name]).toEqual('new value');
    expect(records.records.length).toBe(3);
  });

  it('duplicate base with link field', async () => {
    const table1 = await createTable(base.id, { name: 'table1' });
    const table2 = await createTable(base.id, { name: 'table2' });

    // create link field
    const table2LinkFieldRo: IFieldRo = {
      name: 'link field',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: table1.id,
      },
    };

    const table2LinkField = (await createField(table2.id, table2LinkFieldRo)).data;
    // create lookup field
    const table2LookupFieldRo: IFieldRo = {
      name: 'lookup field',
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: table1.id,
        linkFieldId: table2LinkField.id,
        lookupFieldId: table1.fields[0].id,
      } as ILookupOptionsRo,
    };

    const table2LookupField = (await createField(table2.id, table2LookupFieldRo)).data;

    const table1LinkField = (
      await getField(
        table1.id,
        (table2LinkField.options as ILinkFieldOptions).symmetricFieldId as string
      )
    ).data;

    const table1Records = await getRecords(table1.id);
    const table2Records = await getRecords(table2.id);
    // update record before copy
    await updateRecord(table2.id, table2Records.records[0].id, {
      record: { fields: { [table2LinkField.name]: [{ id: table1Records.records[0].id }] } },
    });
    await updateRecord(table1.id, table1Records.records[0].id, {
      record: { fields: { [table1.fields[0].name]: 'text 1' } },
    });

    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
      withRecords: true,
    });
    const newBaseId = dupResult.data.id;

    const getResult = await getTableList(newBaseId);
    const newTable1 = getResult.data[0];
    const newTable2 = getResult.data[1];

    const newTable1Records = await getRecords(newTable1.id);
    const newTable2Records = await getRecords(newTable2.id);
    expect(newTable1Records.records[0].lastModifiedBy).toBeFalsy();
    expect(newTable1Records.records[0].createdTime).toBeTruthy();
    expect(newTable1Records.records[0].fields[table1LinkField.name]).toMatchObject([
      {
        id: newTable2Records.records[0].id,
      },
    ]);
    expect(newTable2Records.records[0].fields[table2LookupField.name]).toEqual(['text 1']);
    expect(newTable1Records.records.length).toBe(3);

    // update record in duplicated table
    await updateRecord(newTable2.id, table2Records.records[0].id, {
      record: { fields: { [table2LinkField.name]: [{ id: table1Records.records[1].id }] } },
    });
    await updateRecord(newTable1.id, table1Records.records[2].id, {
      record: { fields: { [table1LinkField.name]: [{ id: table2Records.records[2].id }] } },
    });
    await updateRecord(newTable1.id, table1Records.records[1].id, {
      record: { fields: { [table1.fields[0].name]: 'text 2' } },
    });

    // const table1Fields = await getFields(table1.id);
    // const table2Fields = await getFields(table2.id);
    // const newTable1Fields = await getFields(newTable1.id);
    // const newTable2Fields = await getFields(newTable2.id);
    // console.log('table1LinkField', table1Fields[3]);
    // console.log('table2LinkField', table2Fields[3]);
    // console.log('newTable1LinkField', newTable1Fields[3]);
    // console.log('newTable2LinkField', newTable2Fields[3]);

    const newTable1RecordsAfter = await getRecords(newTable1.id);
    const newTable2RecordsAfter = await getRecords(newTable2.id);
    expect(newTable1RecordsAfter.records[0].fields[table1LinkField.name]).toBeUndefined();
    expect(newTable1RecordsAfter.records[1].fields[table1LinkField.name]).toMatchObject([
      {
        id: newTable2Records.records[0].id,
      },
    ]);
    expect(newTable2RecordsAfter.records[2].fields[table2LinkField.name]).toMatchObject([
      {
        id: newTable1Records.records[2].id,
      },
    ]);
    expect(newTable2RecordsAfter.records[0].fields[table2LookupField.name]).toEqual(['text 2']);
  });

  it('should autoNumber work in a duplicated table', async () => {
    await createTable(base.id, { name: 'table1' });
    const dupResult = await duplicateBase({
      fromBaseId: base.id,
      spaceId: spaceId,
      name: 'test base copy',
      withRecords: true,
    });

    const getResult = await getTableList(dupResult.data.id);
    const newTable = getResult.data[0];

    await createRecords(newTable.id, { records: [{ fields: {} }] });

    const records = await getRecords(newTable.id);
    expect(records.records[records.records.length - 1].autoNumber).toEqual(records.records.length);
    expect(records.records.length).toBe(4);
  });

  describe('Duplicate cross space', () => {
    let newSpace: ICreateSpaceVo;
    beforeEach(async () => {
      newSpace = (await createSpace({ name: 'new space' })).data;
    });

    afterEach(async () => {
      await deleteSpace(newSpace.id);
    });

    it('duplicate cross space', async () => {
      await createTable(base.id, { name: 'table1' });
      const dupResult = await duplicateBase({
        fromBaseId: base.id,
        spaceId: newSpace.id,
        name: 'test base copy',
      });

      const baseResult = await getBaseList({ spaceId: newSpace.id });
      const tableResult = await getTableList(dupResult.data.id);
      const records = await getRecords(tableResult.data[0].id);
      expect(records.records.length).toBe(0);
      expect(baseResult.data.length).toBe(1);

      expect(tableResult.data.length).toBe(1);
    });
  });
});
