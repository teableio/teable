import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentCellValue, IAttachmentItem } from '@teable/core';
import { CellFormat, FieldKeyType, FieldType, getRandomString } from '@teable/core';
import type { CreateAccessTokenRo, ITableFullVo } from '@teable/openapi';
import {
  createAccessToken,
  createAxios,
  createBase,
  createSpace,
  getRecord,
  permanentDeleteTable,
  updateRecord,
  uploadAttachment,
  urlBuilder,
  axios as defaultAxios,
  GET_RECORD_URL,
  permanentDeleteSpace,
  listAccessToken,
  deleteAccessToken,
} from '@teable/openapi';
import dayjs from 'dayjs';
import { CacheService } from '../src/cache/cache.service';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import { createAwaitWithEvent } from './utils/event-promise';
import { createField, createTable, initApp } from './utils/init-app';

describe('OpenAPI AttachmentController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo;
  let filePath: string;
  let appUrl: string;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    filePath = path.join(StorageAdapter.TEMPORARY_DIR, 'test-file.txt');
    fs.writeFileSync(filePath, 'This is a test file for attachment upload.');
  });

  afterAll(async () => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    await app.close();
  });

  beforeEach(async () => {
    table = await createTable(baseId, { name: 'table1' });
  });

  afterEach(async () => {
    await permanentDeleteTable(baseId, table.id);
  });

  it('should upload and typecast attachment', async () => {
    const field = await createField(table.id, { type: FieldType.Attachment });

    expect(fs.existsSync(filePath)).toBe(true);

    const fileContent = fs.createReadStream(filePath);

    const record1 = await uploadAttachment(table.id, table.records[0].id, field.id, fileContent, {
      filename: '😀1 2.txt',
    });

    expect(record1.status).toBe(201);
    expect((record1.data.fields[field.id] as Array<object>).length).toEqual(1);
    console.log('record1.data.fields[field.id]', record1.data.fields[field.id]);
    expect((record1.data.fields[field.id] as Array<IAttachmentItem>)[0]!.name).toEqual('😀1 2.txt');

    const record2 = await uploadAttachment(
      table.id,
      table.records[0].id,
      field.id,
      'https://app.teable.ai/favicon.ico'
    );
    expect(record2.status).toBe(201);
    expect((record2.data.fields[field.id] as Array<object>).length).toEqual(2);

    const field2 = await createField(table.id, { type: FieldType.Attachment });
    const record3 = await updateRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      record: {
        fields: {
          [field2.id]: (record2.data.fields[field.id] as Array<{ id: string }>)
            .map((item) => item.id)
            .join(','),
        },
      },
    });
    expect((record3.data.fields[field2.id] as Array<object>).length).toEqual(2);

    const field3 = await createField(table.id, { type: FieldType.Attachment });
    const record4 = await updateRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      record: {
        fields: {
          [field3.id]: (record2.data.fields[field.id] as Array<{ id: string }>).map(
            (item) => item.id
          ),
        },
      },
    });
    expect((record4.data.fields[field3.id] as Array<object>).length).toEqual(2);
  });

  it('should get thumbnail url', async () => {
    const eventEmitterService = app.get(EventEmitterService);
    const awaitWithEvent = createAwaitWithEvent(eventEmitterService, Events.CROP_IMAGE_COMPLETE);
    const imagePath = path.join(StorageAdapter.TEMPORARY_DIR, `./${getRandomString(12)}.svg`);
    fs.writeFileSync(
      imagePath,
      `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="100" cy="100" r="80" fill="blue" />
  <rect x="60" y="60" width="80" height="80" fill="yellow" />
</svg>`
    );
    const imageStream = fs.createReadStream(imagePath);
    const field = await createField(table.id, { type: FieldType.Attachment });

    await awaitWithEvent(async () => {
      await uploadAttachment(table.id, table.records[0].id, field.id, imageStream);
      fs.unlinkSync(imagePath);
    });
    eventEmitterService.eventEmitter.removeAllListeners(Events.CROP_IMAGE_COMPLETE);
    const record = await getRecord(table.id, table.records[0].id);
    const attachment = (record.data.fields[field.name] as IAttachmentCellValue)[0];
    expect(attachment?.lgThumbnailUrl).toBe(attachment.presignedUrl);
    expect(attachment?.smThumbnailUrl).toBeDefined();
    expect(attachment.smThumbnailUrl).not.toBe(attachment.presignedUrl);
  });

  it('should get attachment absolute url by token', async () => {
    const space = await createSpace({ name: 'access token space' }).then((res) => res.data);
    const base = await createBase({ spaceId: space.id, name: 'access token base' }).then(
      (res) => res.data
    );
    const table = await createTable(base.id, { name: 'table1' });
    const field = await createField(table.id, {
      name: 'attachment123',
      type: FieldType.Attachment,
    });

    expect(fs.existsSync(filePath)).toBe(true);

    const fileContent = fs.createReadStream(filePath);
    const recordId = table.records[0].id;
    const record = await uploadAttachment(table.id, recordId, field.id, fileContent);

    expect(record.status).toBe(201);
    expect((record.data.fields[field.id] as Array<object>).length).toEqual(1);
    const attachment = (record.data.fields[field.id] as IAttachmentCellValue)[0]!;
    expect(attachment.presignedUrl?.startsWith(appUrl)).toBe(false);

    const defaultCreateRo: CreateAccessTokenRo = {
      name: 'token1',
      description: 'token1',
      scopes: ['table|read', 'record|read'],
      baseIds: [base.id],
      spaceIds: [space.id],
      expiredTime: dayjs(Date.now() + 1000 * 60 * 60 * 24).format('YYYY-MM-DD'),
    };
    const { data: recordReadTokenData } = await createAccessToken({
      ...defaultCreateRo,
      name: 'record read token',
      scopes: ['record|read'],
    });

    const cacheService = app.get(CacheService);
    await cacheService.del(`attachment:preview:${attachment.token}`);

    const axios = createAxios();
    axios.defaults.baseURL = defaultAxios.defaults.baseURL;
    const res = await axios.get(urlBuilder(GET_RECORD_URL, { tableId: table.id, recordId }), {
      params: {
        fieldKeyType: FieldKeyType.Id,
        cellFormat: CellFormat.Json,
      },
      headers: {
        Authorization: `Bearer ${recordReadTokenData.token}`,
      },
    });

    expect(res.status).toEqual(200);
    expect((res.data.fields[field.id] as Array<object>).length).toEqual(1);
    const attachmentByToken = (res.data.fields[field.id] as IAttachmentCellValue)[0]!;
    expect(attachmentByToken.presignedUrl?.startsWith(appUrl)).toBe(true);

    await permanentDeleteSpace(space.id);
    const { data } = await listAccessToken();
    for (const { id } of data) {
      await deleteAccessToken(id);
    }
  });
});
