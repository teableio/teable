/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, getRandomString } from '@teable/core';
import {
  axios,
  createField,
  createRecords,
  getRecords,
  redo,
  undo,
  type ITableFullVo,
} from '@teable/openapi';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createEventPromise } from './utils/event-promise';
import { initApp, deleteTable, createTable } from './utils/init-app';

describe('Undo Redo (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let eventEmitterService: EventEmitterService;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);
    const windowId = 'win' + getRandomString(8);
    axios.interceptors.request.use((config) => {
      config.headers['X-Window-Id'] = windowId;
      return config;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    table = await createTable(baseId, { name: 'table1' });
  });

  afterEach(async () => {
    await deleteTable(baseId, table.id);
  });

  it('should undo / redo create records', async () => {
    await createField(table.id, { type: FieldType.CreatedTime });
    await createField(table.id, { type: FieldType.LastModifiedTime });

    const promise = createEventPromise(eventEmitterService, Events.OPERATION_PUSH);
    const records = await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [table.fields[0].id]: 'record1' } }],
    });
    await promise;

    const allRecords = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(allRecords.data.records).toHaveLength(4);

    await undo(table.id);

    const allRecordsAfterUndo = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(allRecordsAfterUndo.data.records).toHaveLength(3);
    expect(
      allRecordsAfterUndo.data.records.find((r) => r.id === records.data.records[0].id)
    ).toBeUndefined();

    await redo(table.id);

    const allRecordsAfterRedo = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(allRecordsAfterRedo.data.records).toHaveLength(4);
    expect(
      allRecordsAfterRedo.data.records.find((r) => r.id === records.data.records[0].id)
    ).toMatchObject(records.data.records[0]);
  });
});
