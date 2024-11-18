import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldKeyType, FieldType, Role } from '@teable/core';
import {
  deleteSpaceCollaborator,
  emailSpaceInvitation,
  getRecord,
  getRecords,
  updateRecord,
  USER_ME,
  deleteTable,
  UPDATE_USER_NAME,
  urlBuilder,
  CREATE_FIELD,
  CREATE_TABLE,
  emailBaseInvitation,
} from '@teable/openapi';
import type { IUserMeVo, ITableFullVo } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createAwaitWithEvent } from './utils/event-promise';
import { createBase, createField, createTable, deleteBase, initApp } from './utils/init-app';

describe('Computed user field (e2e)', () => {
  let app: INestApplication;
  const spaceId = globalThis.testConfig.spaceId;
  const userName = globalThis.testConfig.userName;
  let baseId: string;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    const base = await createBase({ name: 'base1', spaceId });
    baseId = base.id;
  });

  afterAll(async () => {
    await deleteBase(baseId);
    await app.close();
  });

  describe('CRUD', () => {
    let table1: ITableFullVo;

    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
    });

    afterEach(async () => {
      await deleteTable(baseId, table1.id);
    });

    it('should create a created by field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.CreatedBy,
      };

      const createdByField = await createField(table1.id, fieldRo);
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      records.data.records.forEach((record) => {
        expect(record.fields[createdByField.id]).toMatchObject({
          title: userName,
        });
      });
    });

    it('should create a last modified by field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.LastModifiedBy,
      };

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const lastModifiedByField = await createField(table1.id, fieldRo);
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(records.data.records[0].fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });

      expect(records.data.records[1].fields[lastModifiedByField.id]).toBeUndefined();

      await updateRecord(table1.id, table1.records[1].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test2',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const updatedRecord = await getRecord(table1.id, records.data.records[1].id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(updatedRecord.data.fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });
    });

    it('should update formula result depends on a last modified by field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.LastModifiedBy,
      };

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const lastModifiedByField = await createField(table1.id, fieldRo);

      const formulaFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${lastModifiedByField.id}}`,
        },
      };

      const formulaField = await createField(table1.id, formulaFieldRo);

      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(records.data.records[0].fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });

      expect(records.data.records[0].fields[formulaField.id]).toEqual(userName);

      expect(records.data.records[1].fields[lastModifiedByField.id]).toBeUndefined();

      await updateRecord(table1.id, table1.records[1].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test2',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const updatedRecord = await getRecord(table1.id, table1.records[1].id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(updatedRecord.data.fields[lastModifiedByField.id]).toMatchObject({
        title: userName,
      });

      expect(updatedRecord.data.fields[formulaField.id]).toEqual(userName);
    });

    it('should update formula result depends on a last modified time field', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.LastModifiedTime,
      };

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const lastModifiedTimeField = await createField(table1.id, fieldRo);

      const formulaFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${lastModifiedTimeField.id}}`,
        },
      };

      const formulaField = await createField(table1.id, formulaFieldRo);

      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(records.data.records[0].fields[lastModifiedTimeField.id]).toEqual(
        records.data.records[0].lastModifiedTime
      );

      expect(records.data.records[0].fields[formulaField.id]).toEqual(
        records.data.records[0].lastModifiedTime
      );

      expect(records.data.records[1].fields[lastModifiedTimeField.id]).toBeUndefined();

      await updateRecord(table1.id, table1.records[1].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'test2',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });

      const updatedRecord = await getRecord(table1.id, table1.records[1].id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(updatedRecord.data.fields[lastModifiedTimeField.id]).toEqual(
        updatedRecord.data.lastModifiedTime
      );

      expect(updatedRecord.data.fields[formulaField.id]).toEqual(
        updatedRecord.data.lastModifiedTime
      );
    });
  });

  describe('rename', () => {
    let user2Request: AxiosInstance;
    let user2: IUserMeVo;
    let table1: ITableFullVo;
    let eventEmitterService: EventEmitterService;
    let awaitWithEvent: <T>(fn: () => Promise<T>) => Promise<T>;

    beforeAll(async () => {
      user2Request = await createNewUserAxios({
        email: 'renameUser@example.com',
        password: '12345678',
      });

      user2Request.patch<void>(urlBuilder(UPDATE_USER_NAME), { name: 'default' });
      user2 = (await user2Request.get<IUserMeVo>(USER_ME)).data;

      await emailSpaceInvitation({
        spaceId: globalThis.testConfig.spaceId,
        emailSpaceInvitationRo: { role: Role.Creator, emails: ['renameUser@example.com'] },
      });
      table1 = (
        await user2Request.post<ITableFullVo>(urlBuilder(CREATE_TABLE, { baseId }), {
          name: 'table1',
        })
      ).data;

      eventEmitterService = app.get(EventEmitterService);
      awaitWithEvent = createAwaitWithEvent(eventEmitterService, Events.TABLE_USER_RENAME_COMPLETE);
    });

    afterAll(async () => {
      await deleteSpaceCollaborator({
        spaceId: globalThis.testConfig.spaceId,
        userId: user2.id,
      });
      await deleteTable(baseId, table1.id);
    });

    it('should update createdBy fields when user rename', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.CreatedBy,
      };

      const field = await user2Request
        .post<IFieldVo>(urlBuilder(CREATE_FIELD, { tableId: table1.id }), fieldRo)
        .then((res) => res.data);

      await awaitWithEvent(() => user2Request.patch<void>(UPDATE_USER_NAME, { name: 'new name' }));

      const getRecordsResponse = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      getRecordsResponse.data.records.forEach((record) => {
        expect(record.fields[field.id]).toMatchObject({
          title: 'new name',
        });
      });
    });

    it('should update createBy fields when user rename - base collaborator', async () => {
      const user3Request = await createNewUserAxios({
        email: 'renameUser3@example.com',
        password: '12345678',
      });
      await emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { role: Role.Creator, emails: ['renameUser3@example.com'] },
      });
      const table = (
        await user3Request.post<ITableFullVo>(urlBuilder(CREATE_TABLE, { baseId }), {
          name: 'table2',
        })
      ).data;
      const field = await user3Request
        .post<IFieldVo>(urlBuilder(CREATE_FIELD, { tableId: table.id }), {
          type: FieldType.CreatedBy,
        })
        .then((res) => res.data);
      await awaitWithEvent(() => user3Request.patch<void>(UPDATE_USER_NAME, { name: 'new name' }));

      const getRecordsResponse = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      getRecordsResponse.data.records.forEach((record) => {
        expect(record.fields[field.id]).toMatchObject({
          title: 'new name',
        });
      });
    });

    it('should update user fields when user rename', async () => {
      const fieldRo: IFieldRo = {
        type: FieldType.User,
        options: {
          isMultiple: true,
          shouldNotify: false,
        },
      };

      const field = (
        await user2Request.post<IFieldVo>(urlBuilder(CREATE_FIELD, { tableId: table1.id }), fieldRo)
      ).data;

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [field.id]: [globalThis.testConfig.userId, user2.id],
          },
        },
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
      });

      await awaitWithEvent(() =>
        user2Request.patch<void>(UPDATE_USER_NAME, { name: 'new name 2' })
      );

      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(records.data.records[0].fields[field.id]).toMatchObject([
        {
          title: 'test',
        },
        {
          title: 'new name 2',
        },
      ]);
    });
  });
});
