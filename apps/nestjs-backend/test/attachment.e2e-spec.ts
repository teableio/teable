/* eslint-disable sonarjs/no-duplicate-string */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentCellValue, IAttachmentItem } from '@teable/core';
import { CellFormat, FieldKeyType, FieldType, getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { CreateAccessTokenRo, ITableFullVo, IUserMeVo } from '@teable/openapi';
import {
  createAccessToken,
  createAxios,
  createBase,
  createSpace,
  deleteField as deleteFieldApi,
  exportBase,
  getRecord,
  getSignature,
  getTrashItems,
  notify,
  resetTrashItems,
  updateRecord,
  uploadAttachment,
  uploadFile,
  urlBuilder,
  axios as defaultAxios,
  GET_RECORD_URL,
  permanentDeleteSpace,
  listAccessToken,
  deleteAccessToken,
  READ_PATH,
  UPDATE_USER_AVATAR,
  USER_ME,
  ResourceType,
  TableTrashType,
  TrashType,
  UploadType,
} from '@teable/openapi';
import dayjs from 'dayjs';
import * as unzipper from 'unzipper';
import { CacheService } from '../src/cache/cache.service';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { AttachmentsService } from '../src/features/attachments/attachments.service';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import type { LocalStorage } from '../src/features/attachments/plugins/local';
import { createAwaitWithEvent, createAwaitWithEventWithResult } from './utils/event-promise';
import {
  permanentDeleteBase,
  permanentDeleteTable,
  createField,
  createTable,
  initApp,
} from './utils/init-app';

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

  it('rejects signatures for backend-only cold archive upload types', async () => {
    // these prefixes are written exclusively by the backend flushers; a
    // client-signed upload could forge cold parts or burn untracked storage
    for (const type of [
      UploadType.RecordHistory,
      UploadType.RecordRemoval,
      UploadType.WorkflowRunCold,
      UploadType.AuditLogCold,
    ]) {
      const error = await getSignature({
        type,
        contentLength: 10,
        contentType: 'application/octet-stream',
      }).catch((e) => e);
      expect(error).toMatchObject({ status: 400 });
    }
  });

  afterEach(async () => {
    await permanentDeleteTable(baseId, table.id);
  });

  describe('v2 attachment write validation', () => {
    const previousForceV2All = process.env.FORCE_V2_ALL;

    beforeAll(() => {
      process.env.FORCE_V2_ALL = 'true';
    });

    afterAll(() => {
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    });

    it('rejects computed attachment writes before type validation without changing stored cells', async () => {
      const created = await createField(table.id, { type: FieldType.CreatedTime });
      const text = table.fields.find((field) => field.type === FieldType.SingleLineText)!;
      const attachment = await createField(table.id, { type: FieldType.Attachment });
      const recordId = table.records[0].id;
      const before = await getRecord(table.id, recordId, { fieldKeyType: FieldKeyType.Id });
      expect(before.data.fields[created.id]).toEqual(expect.any(String));

      const uploaded = await uploadAttachment(
        table.id,
        recordId,
        attachment.id,
        fs.createReadStream(filePath)
      );
      expect(uploaded.status).toBe(201);
      expect(uploaded.headers['x-teable-v2']).toBe('true');
      const item = (uploaded.data.fields[attachment.id] as IAttachmentCellValue)[0]!;
      const uploadFile = vi.spyOn(app.get(AttachmentsService), 'uploadFile');

      try {
        for (const [fieldId, i18nKey] of [
          [created.id, 'httpErrors.field.isComputed'],
          [text.id, 'httpErrors.field.notAttachment'],
        ]) {
          const url = `/table/${table.id}/record/${recordId}/${fieldId}`;
          const multipart = await defaultAxios.postForm(
            `${url}/uploadAttachment`,
            { file: fs.createReadStream(filePath) },
            { validateStatus: () => true }
          );
          const inserted = await defaultAxios.post(
            `${url}/insertAttachment`,
            { attachments: [item] },
            { validateStatus: () => true }
          );
          for (const response of [multipart, inserted]) {
            expect(response.status).toBe(400);
            expect(response.headers['x-teable-v2']).toBe('true');
            expect(response.data).toMatchObject({
              code: 'validation_error',
              data: { localization: { i18nKey } },
            });
          }
        }
        expect(uploadFile).not.toHaveBeenCalled();
        const after = await getRecord(table.id, recordId, { fieldKeyType: FieldKeyType.Id });
        expect(after.data.fields[created.id]).toEqual(before.data.fields[created.id]);
        expect(after.data.fields[text.id]).toEqual(before.data.fields[text.id]);
        expect(
          (after.data.fields[attachment.id] as IAttachmentCellValue).map(({ id }) => id)
        ).toEqual([item.id]);
      } finally {
        uploadFile.mockRestore();
      }

      const appended = await uploadAttachment(
        table.id,
        recordId,
        attachment.id,
        fs.createReadStream(filePath)
      );
      expect(appended.status).toBe(201);
      const items = appended.data.fields[attachment.id] as IAttachmentCellValue;
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe(item.id);
      expect(items[1]!.id).not.toBe(item.id);
    });
  });

  describe('url attachment upload', () => {
    const fileBody = 'remote attachment body';
    const previousForceV2All = process.env.FORCE_V2_ALL;
    const previousSsrfDisabled = process.env.TEABLE_SSRF_PROTECTION_DISABLED;
    let server: http.Server;
    let origin: string;

    beforeAll(async () => {
      process.env.FORCE_V2_ALL = 'true';
      process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
      server = http.createServer((req, res) => {
        if (req.url === '/refused') {
          res.statusCode = req.method === 'HEAD' ? 404 : 403;
          res.end('refused');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Length', String(Buffer.byteLength(fileBody)));
        res.end(fileBody);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
      if (previousSsrfDisabled == null) {
        delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
      } else {
        process.env.TEABLE_SSRF_PROTECTION_DISABLED = previousSsrfDisabled;
      }
    });

    it('rejects an unreachable remote url as a validation error', async () => {
      const field = await createField(table.id, { type: FieldType.Attachment });
      const recordId = table.records[0].id;
      const url = `/table/${table.id}/record/${recordId}/${field.id}/uploadAttachment`;

      const refused = await defaultAxios.post(
        url,
        { fileUrl: `${origin}/refused` },
        { validateStatus: () => true }
      );
      expect(refused.status).toBe(400);
      expect(refused.headers['x-teable-v2']).toBe('true');
      expect(refused.data).toMatchObject({
        message: 'Url reject',
        code: 'validation_error',
        data: { localization: { i18nKey: 'httpErrors.attachment.urlReject' } },
      });

      const accepted = await defaultAxios.post(
        url,
        { fileUrl: `${origin}/file.txt` },
        { validateStatus: () => true }
      );
      expect(accepted.status).toBe(201);
      expect(accepted.data.fields[field.id]).toHaveLength(1);
    });
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

    const existingAttachment = (record1.data.fields[field.id] as IAttachmentCellValue)[0]!;
    const presignedUrl = existingAttachment.presignedUrl || '';
    const localAttachmentUrl = presignedUrl.startsWith('http')
      ? presignedUrl
      : `${appUrl}${presignedUrl}`;
    const record2 = await uploadAttachment(
      table.id,
      table.records[0].id,
      field.id,
      localAttachmentUrl
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

  it('should keep cross-origin headers on the 304 cache-hit read path', async () => {
    const field = await createField(table.id, { type: FieldType.Attachment });
    const uploadResult = await uploadAttachment(
      table.id,
      table.records[0].id,
      field.id,
      fs.createReadStream(filePath)
    );
    expect(uploadResult.status).toBe(201);

    const attachment = (uploadResult.data.fields[field.id] as IAttachmentCellValue)[0]!;
    const presignedUrl = attachment.presignedUrl ?? '';
    const readUrl = presignedUrl.startsWith('http') ? presignedUrl : `${appUrl}${presignedUrl}`;

    const axios = createAxios();
    axios.defaults.validateStatus = (status) => status === 200 || status === 304;

    // The 200 read sets a non-`same-origin` CORP so the attachment can be
    // embedded cross-origin.
    const firstRes = await axios.get(readUrl, { responseType: 'arraybuffer' });
    expect(firstRes.status).toBe(200);
    const corp = firstRes.headers['cross-origin-resource-policy'];
    expect(corp).not.toBe('same-origin');

    // Regression: revalidation returns 304 — it must carry the same CORP header
    // as the 200 read, otherwise helmet's default `same-origin` leaks into the
    // 304 and the browser blocks the cross-origin embedded attachment.
    const cachedRes = await axios.get(readUrl, {
      responseType: 'arraybuffer',
      headers: { 'If-Modified-Since': firstRes.headers['last-modified'] },
    });
    expect(cachedRes.status).toBe(304);
    expect(cachedRes.headers['cross-origin-resource-policy']).toBe(corp);
  });

  describe('local read authorization', () => {
    const toAbsolute = (url: string) => (url.startsWith('http') ? url : `${appUrl}${url}`);
    // no session cookie, every status resolves: the read route is public and
    // must stand on the token alone
    const anonymousAxios = () => {
      const instance = createAxios();
      instance.defaults.validateStatus = () => true;
      return instance;
    };
    const uploadPrivate = async (content: Buffer | string, contentType: string, name?: string) => {
      const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const { token, requestHeaders } =
        // baseId: the EE signature override requires it for table uploads
        (
          await getSignature({
            type: UploadType.Table,
            contentLength: body.length,
            contentType,
            baseId,
          })
        ).data;
      await uploadFile(token, body, requestHeaders);
      return (await notify(token, undefined, name)).data;
    };

    it('rejects private reads without a token sealed to the requested path', async () => {
      const a = await uploadPrivate('attachment a', 'text/plain');
      const b = await uploadPrivate('attachment b', 'text/plain');
      const anon = anonymousAxios();
      const urlA = new URL(toAbsolute(a.presignedUrl));
      const urlB = new URL(toAbsolute(b.presignedUrl));
      const tokenA = urlA.searchParams.get('token')!;
      expect(tokenA).toBeTruthy();
      expect((await anon.get(urlA.href)).status).toBe(200);

      // the token is the only credential: strip it
      const stripped = new URL(urlA.href);
      stripped.searchParams.delete('token');
      expect((await anon.get(stripped.href)).status).toBe(400);

      // a valid token opens only the object it was minted for
      const replayed = new URL(urlB.href);
      replayed.searchParams.set('token', tokenA);
      expect((await anon.get(replayed.href)).status).toBe(400);
      expect((await anon.get(urlB.href)).status).toBe(200);

      // backend-only archives are never served here, whatever token is shown
      const bucket = StorageAdapter.getBucket(UploadType.Table);
      const localStorage = app.get(AttachmentsService).storageAdapter as LocalStorage;
      const statsPath = `record-history/v1/${table.id}/_stats.json`;
      const statsFile = path.join(localStorage.storageDir, bucket, statsPath);
      fs.mkdirSync(path.dirname(statsFile), { recursive: true });
      fs.writeFileSync(statsFile, '{}');
      try {
        const statsUrl = new URL(`${appUrl}${READ_PATH}/${bucket}/${statsPath}`);
        expect((await anon.get(statsUrl.href)).status).toBe(400);
        statsUrl.searchParams.set('token', tokenA);
        expect((await anon.get(statsUrl.href)).status).toBe(400);
        statsUrl.searchParams.set(
          'token',
          localStorage.readTokenCodec.encode({ path: `${bucket}/${statsPath}`, expiresDate: -1 })
        );
        expect((await anon.get(statsUrl.href)).status).toBe(400);
      } finally {
        fs.rmSync(path.dirname(statsFile), { recursive: true, force: true });
      }
    });

    it('forces a download for active content and keeps images inline', async () => {
      const svg = await uploadPrivate(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        'image/svg+xml'
      );
      const html = await uploadPrivate(
        '<html><body><script>alert(1)</script></body></html>',
        'text/html'
      );
      const png = await uploadPrivate(
        fs.readFileSync(path.join(__dirname, '../static/test/test-image.png')),
        'image/png'
      );
      const anon = anonymousAxios();

      for (const item of [svg, html]) {
        // presignedUrl is the cached preview url, url the never-expiring one
        // minted at notify time — both must download
        for (const url of [item.presignedUrl, item.url]) {
          const res = await anon.get(toAbsolute(url), { responseType: 'arraybuffer' });
          expect(res.status).toBe(200);
          expect(res.headers['content-type']).toContain(item.mimetype);
          expect(res.headers['content-disposition']).toMatch(/^attachment/);
          expect(res.headers['content-security-policy']).toContain("script-src 'none'");
        }
        // nor can the caller opt back into inline rendering
        const inline = new URL(toAbsolute(item.presignedUrl));
        inline.searchParams.set('response-content-disposition', 'inline');
        const res = await anon.get(inline.href, { responseType: 'arraybuffer' });
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toMatch(/^attachment/);
      }

      const res = await anon.get(toAbsolute(png.presignedUrl), { responseType: 'arraybuffer' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(res.headers['content-security-policy']).toContain("script-src 'none'");
    });

    it('forces a download for types that are not plainly inline-safe', async () => {
      const anon = anonymousAxios();
      // an alias Express expands to text/html, a list whose last entry wins, an xml dialect
      for (const contentType of ['html', 'image/png,text/html', 'text/xsl']) {
        const item = await uploadPrivate('<html><body>x</body></html>', contentType);
        const res = await anon.get(toAbsolute(item.presignedUrl), { responseType: 'arraybuffer' });
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toMatch(/^attachment/);
      }
    });

    it('copies an attachment by its own presigned url but refuses foreign private paths', async () => {
      const field = await createField(table.id, { type: FieldType.Attachment });
      const own = await uploadPrivate('copy me', 'text/plain', 'copy-me.txt');

      const copied = await uploadAttachment(
        table.id,
        table.records[0].id,
        field.id,
        toAbsolute(own.presignedUrl)
      );
      expect(copied.status).toBe(201);
      const copiedItem = (copied.data.fields[field.id] as IAttachmentCellValue)[0]!;
      expect(copiedItem.size).toBe(own.size);
      // the type the url was issued with travels with the copy
      expect(copiedItem.mimetype).toBe('text/plain');

      const bucket = StorageAdapter.getBucket(UploadType.Table);
      const foreign = `${appUrl}${READ_PATH}/${bucket}/${own.path}`;
      const noToken = await uploadAttachment(
        table.id,
        table.records[0].id,
        field.id,
        foreign
      ).catch((e) => e);
      expect(noToken).toMatchObject({ status: 400 });

      const other = await uploadPrivate('other', 'text/plain');
      const otherToken = new URL(toAbsolute(other.presignedUrl)).searchParams.get('token')!;
      const replayed = await uploadAttachment(
        table.id,
        table.records[0].id,
        field.id,
        `${foreign}?token=${otherToken}`
      ).catch((e) => e);
      expect(replayed).toMatchObject({ status: 400 });

      const record = await getRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
      });
      expect((record.data.fields[field.id] as IAttachmentCellValue).length).toBe(1);
    });

    it('serves public-bucket objects without a token', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([fs.readFileSync(path.join(__dirname, '../static/test/test-image.png'))], {
          type: 'image/png',
        }),
        'avatar.png'
      );
      expect((await defaultAxios.patch(UPDATE_USER_AVATAR, formData)).status).toBe(200);
      const me = (await defaultAxios.get<IUserMeVo>(USER_ME)).data;
      expect(me.avatar).toContain(READ_PATH);
      expect(me.avatar).not.toContain('token=');

      // the avatar url carries the configured storage prefix; only its path
      // matters here, so point it at the app under test
      const avatarUrl = new URL(me.avatar!, appUrl);
      const res = await anonymousAxios().get(
        new URL(`${avatarUrl.pathname}${avatarUrl.search}`, appUrl).href,
        { responseType: 'arraybuffer' }
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/');
    });
  });

  it('should keep a non-ASCII file name single-encoded on the local read path', async () => {
    const csvPath = path.join(
      StorageAdapter.TEMPORARY_DIR,
      `encoded-name-${getRandomString(8)}.csv`
    );
    fs.writeFileSync(csvPath, 'field_1,field_2\n1,foo\n');
    const stats = fs.statSync(csvPath);

    const { token, requestHeaders } = (
      await getSignature({
        type: UploadType.Import,
        contentLength: stats.size,
        contentType: 'text/csv',
      })
    ).data;
    await uploadFile(token, fs.createReadStream(csvPath), requestHeaders);
    const {
      data: { presignedUrl },
    } = await notify(token, undefined, '表格 3 (2).csv');
    fs.unlinkSync(csvPath);

    const readUrl = presignedUrl.startsWith('http') ? presignedUrl : `${appUrl}${presignedUrl}`;
    const res = await createAxios().get(readUrl, { responseType: 'arraybuffer' });
    expect(res.status).toBe(200);
    // Regression: the read endpoint used to re-encode the already-encoded
    // RFC 5987 value, producing a double-encoded file name (%25E8%25A1...).
    expect(res.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''%E8%A1%A8%E6%A0%BC%203%20(2).csv"
    );
  });

  it('should write attachment with simplified ro format without typecast', async () => {
    // Step 1: Upload attachment to get token
    const field = await createField(table.id, { type: FieldType.Attachment });

    expect(fs.existsSync(filePath)).toBe(true);

    const fileContent = fs.createReadStream(filePath);
    const uploadResult = await uploadAttachment(
      table.id,
      table.records[0].id,
      field.id,
      fileContent,
      {
        filename: 'test-upload.txt',
      }
    );

    expect(uploadResult.status).toBe(201);
    const uploadedAttachment = (uploadResult.data.fields[field.id] as IAttachmentCellValue)[0]!;
    expect(uploadedAttachment).toBeDefined();
    expect(uploadedAttachment.token).toBeDefined();
    expect(uploadedAttachment.size).toBeDefined();
    expect(uploadedAttachment.mimetype).toBeDefined();

    // Step 2: Create another field to test writing with simplified format
    const field2 = await createField(table.id, { type: FieldType.Attachment });

    // Step 3: Write attachment using simplified format WITHOUT typecast
    const simplifiedAttachmentRo = [
      {
        name: 'renamed-file.txt', // User can rename
        token: uploadedAttachment.token,
      },
    ];

    const updateResult = await updateRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
      typecast: false, // ❗ Key point: without typecast
      record: {
        fields: {
          [field2.id]: simplifiedAttachmentRo,
        },
      },
    });

    expect(updateResult.status).toBe(200);

    // Step 4: Re-fetch record to verify data is actually stored in DB
    const storedRecord = await getRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
    });
    const resultAttachments = storedRecord.data.fields[field2.id] as IAttachmentCellValue;
    expect(resultAttachments).toBeDefined();
    expect(resultAttachments.length).toBe(1);

    // Step 5: Verify all metadata is present from stored data
    const resultAttachment = resultAttachments[0]!;
    console.log('resultAttachment from DB:', resultAttachment);
    expect(resultAttachment.id).toBeDefined();
    expect(resultAttachment.id).toMatch(/^act/); // Should have attachment ID prefix
    expect(resultAttachment.name).toBe('renamed-file.txt'); // Should use the name from ro
    expect(resultAttachment.token).toBe(uploadedAttachment.token); // Same token
    expect(resultAttachment.size).toBe(uploadedAttachment.size); // Metadata from DB
    expect(resultAttachment.mimetype).toBe(uploadedAttachment.mimetype); // Metadata from DB
    expect(resultAttachment.path).toBeDefined(); // Metadata from DB
    expect(resultAttachment.presignedUrl).toBeDefined();

    // Step 6: Test with optional id (reuse existing attachment id)
    const field3 = await createField(table.id, { type: FieldType.Attachment });
    const simplifiedAttachmentRoWithId = [
      {
        id: resultAttachment.id, // Reuse the id
        name: 'renamed-again.txt',
        token: uploadedAttachment.token,
      },
    ];

    const updateResult2 = await updateRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
      typecast: false, // Still without typecast
      record: {
        fields: {
          [field3.id]: simplifiedAttachmentRoWithId,
        },
      },
    });

    expect(updateResult2.status).toBe(200);

    // Step 7: Re-fetch record again to verify id reuse is stored correctly
    const storedRecord2 = await getRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
    });
    const resultAttachments2 = storedRecord2.data.fields[field3.id] as IAttachmentCellValue;
    expect(resultAttachments2.length).toBe(1);

    const resultAttachment2 = resultAttachments2[0]!;
    console.log('resultAttachment2 from DB:', resultAttachment2);
    expect(resultAttachment2.id).toBe(resultAttachment.id); // Should reuse the same id
    expect(resultAttachment2.name).toBe('renamed-again.txt');
    expect(resultAttachment2.token).toBe(uploadedAttachment.token);
    expect(resultAttachment2.size).toBeDefined();
    expect(resultAttachment2.mimetype).toBeDefined();
    expect(resultAttachment2.path).toBeDefined();
  });

  it('should regenerate presignedUrl when attachment name is changed', async () => {
    const field = await createField(table.id, { type: FieldType.Attachment });

    expect(fs.existsSync(filePath)).toBe(true);

    // Step 1: Upload attachment with the original name
    const fileContent = fs.createReadStream(filePath);
    const uploadResult = await uploadAttachment(
      table.id,
      table.records[0].id,
      field.id,
      fileContent,
      { filename: 'original-name.txt' }
    );
    expect(uploadResult.status).toBe(201);
    const uploadedAttachment = (uploadResult.data.fields[field.id] as IAttachmentCellValue)[0]!;
    expect(uploadedAttachment.name).toBe('original-name.txt');

    // Step 2: Read the record to capture the cached presignedUrl from the read path
    const recordBefore = await getRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
    });
    const attachmentBefore = (recordBefore.data.fields[field.id] as IAttachmentCellValue)[0]!;
    expect(attachmentBefore.presignedUrl).toBeDefined();

    // Step 3: Rename the attachment (same token, different name)
    const updateResult = await updateRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [field.id]: [
            {
              id: uploadedAttachment.id,
              name: 'renamed-file.txt',
              token: uploadedAttachment.token,
            },
          ],
        },
      },
    });

    // Verify the updateRecord response itself contains the correct presignedUrl
    const attachmentFromUpdate = (updateResult.data.fields[field.id] as IAttachmentCellValue)[0]!;
    expect(attachmentFromUpdate.name).toBe('renamed-file.txt');
    expect(attachmentFromUpdate.presignedUrl).toBeDefined();
    expect(attachmentFromUpdate.presignedUrl).toContain('renamed-file.txt');
    expect(attachmentFromUpdate.presignedUrl).not.toContain('original-name.txt');

    // Step 4: Read again — presignedUrl must also be correct on the read path
    const recordAfter = await getRecord(table.id, table.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
    });
    const attachmentAfter = (recordAfter.data.fields[field.id] as IAttachmentCellValue)[0]!;
    expect(attachmentAfter.name).toBe('renamed-file.txt');
    expect(attachmentAfter.presignedUrl).toBeDefined();
    expect(attachmentAfter.presignedUrl).not.toBe(attachmentBefore.presignedUrl);
    expect(attachmentAfter.presignedUrl).toContain('renamed-file.txt');
    expect(attachmentAfter.presignedUrl).not.toContain('original-name.txt');
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

  it('T8166 purges attachment references when permanently resetting deleted field trash', async () => {
    const prisma = app.get(PrismaService);
    const deletedField = await createField(table.id, { type: FieldType.Attachment });
    const retainedField = await createField(table.id, { type: FieldType.Attachment });
    const recordId = table.records[0]!.id;
    const upload = await uploadAttachment(
      table.id,
      recordId,
      deletedField.id,
      fs.createReadStream(filePath)
    );

    expect(upload.status).toBe(201);
    expect(upload.headers['x-teable-v2']).toBe('true');
    const attachment = (upload.data.fields[deletedField.id] as IAttachmentCellValue)[0]!;
    const retained = await updateRecord(table.id, recordId, {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      record: { fields: { [retainedField.id]: [attachment] } },
    });
    expect(retained.data.fields[retainedField.id]).toHaveLength(1);

    await expect(
      prisma.attachmentsTable.count({ where: { tableId: table.id, fieldId: deletedField.id } })
    ).resolves.toBe(1);
    await expect(
      prisma.attachmentsTable.count({ where: { tableId: table.id, fieldId: retainedField.id } })
    ).resolves.toBe(1);

    const deleted = await deleteFieldApi(table.id, deletedField.id);
    expect(deleted.status).toBe(200);
    expect(deleted.headers['x-teable-v2']).toBe('true');
    await expect(
      prisma.attachmentsTable.count({ where: { tableId: table.id, fieldId: deletedField.id } })
    ).resolves.toBe(1);

    let fieldTrashExists = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const trash = await getTrashItems({ resourceId: table.id, resourceType: TrashType.Table });
      fieldTrashExists = trash.data.trashItems.some(
        (item) =>
          item.resourceType === TableTrashType.Field && item.resourceIds.includes(deletedField.id)
      );
      if (fieldTrashExists) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    expect(fieldTrashExists).toBe(true);

    await resetTrashItems({ resourceType: ResourceType.Table, resourceId: table.id });

    await expect(prisma.field.findUnique({ where: { id: deletedField.id } })).resolves.toBeNull();
    await expect(
      prisma.attachmentsTable.count({ where: { tableId: table.id, fieldId: deletedField.id } })
    ).resolves.toBe(0);
    await expect(
      prisma.attachmentsTable.count({ where: { tableId: table.id, fieldId: retainedField.id } })
    ).resolves.toBe(1);
    await expect(prisma.attachments.count({ where: { token: attachment.token } })).resolves.toBe(1);
  });

  it('T8166 excludes attachments from permanently deleted fields in the v2 base export', async () => {
    const prisma = app.get(PrismaService);
    const exportBaseRecord = (
      await createBase({
        spaceId: globalThis.testConfig.spaceId,
        name: `T8166 attachment export ${Date.now()}`,
      })
    ).data;
    let exportPath: string | undefined;

    try {
      expect(
        await prisma.base.findUnique({
          where: { id: exportBaseRecord.id },
          select: { v2Enabled: true },
        })
      ).toMatchObject({ v2Enabled: true });

      const exportTable = await createTable(exportBaseRecord.id, {
        name: 'Attachment export',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Deleted attachment', type: FieldType.Attachment },
          { name: 'Retained attachment', type: FieldType.Attachment },
        ],
        records: [{ fields: { Name: 'synthetic' } }],
      });
      const deletedField = exportTable.fields.find((field) => field.name === 'Deleted attachment')!;
      const retainedField = exportTable.fields.find(
        (field) => field.name === 'Retained attachment'
      )!;
      const recordId = exportTable.records[0]!.id;
      const deletedUpload = await uploadAttachment(
        exportTable.id,
        recordId,
        deletedField.id,
        Buffer.from('deleted attachment fixture'),
        { filename: 'deleted-fixture.txt' }
      );
      const retainedUpload = await uploadAttachment(
        exportTable.id,
        recordId,
        retainedField.id,
        Buffer.from('retained attachment fixture'),
        { filename: 'retained-fixture.txt' }
      );
      const deletedAttachment = (
        deletedUpload.data.fields[deletedField.id] as IAttachmentCellValue
      )[0]!;
      const retainedAttachment = (
        retainedUpload.data.fields[retainedField.id] as IAttachmentCellValue
      )[0]!;
      expect(deletedUpload.headers['x-teable-v2']).toBe('true');
      expect(retainedUpload.headers['x-teable-v2']).toBe('true');

      await deleteFieldApi(exportTable.id, deletedField.id);
      let fieldTrashExists = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const trash = await getTrashItems({
          resourceId: exportTable.id,
          resourceType: TrashType.Table,
        });
        fieldTrashExists = trash.data.trashItems.some(
          (item) =>
            item.resourceType === TableTrashType.Field && item.resourceIds.includes(deletedField.id)
        );
        if (fieldTrashExists) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      expect(fieldTrashExists).toBe(true);
      await resetTrashItems({ resourceId: exportTable.id, resourceType: ResourceType.Table });

      const awaitExport = createAwaitWithEventWithResult<{
        status?: 'success' | 'failed';
        previewUrl: string;
        attachment?: { name: string; path: string };
        errorMessage?: string;
      }>(app.get(EventEmitterService), Events.BASE_EXPORT_COMPLETE);
      const { status, attachment, errorMessage } = await awaitExport(async () => {
        await exportBase(exportBaseRecord.id);
      });
      expect(status).toBe('success');
      expect(attachment).toBeDefined();
      expect(errorMessage).toBeUndefined();
      exportPath = attachment!.path;

      const storageAdapter = app.get<StorageAdapter>(Symbol.for('ObjectStorage'));
      const archiveStream = await storageAdapter.downloadFile(
        StorageAdapter.getBucket(UploadType.ExportBase),
        exportPath
      );
      const chunks: Buffer[] = [];
      for await (const chunk of archiveStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const zip = await unzipper.Open.buffer(Buffer.concat(chunks));
      const entryNames = zip.files.map((file) => file.path);
      expect(entryNames).toContain(`attachments/${retainedAttachment.token}.txt`);
      expect(entryNames).not.toContain(`attachments/${deletedAttachment.token}.txt`);
      const csvEntry = zip.files.find((file) => file.path === 'attachments/attachments.csv');
      expect(csvEntry).toBeDefined();
      const csv = (await csvEntry!.buffer()).toString('utf8');
      expect(csv).toContain(retainedAttachment.token);
      expect(csv).not.toContain(deletedAttachment.token);
      const structure = zip.files.find((file) => file.path === 'structure.json');
      expect(structure).toBeDefined();
      const structureJson = JSON.parse((await structure!.buffer()).toString('utf8')) as {
        tables: Array<{ id: string; fields: Array<{ id: string }> }>;
      };
      const exportedTable = structureJson.tables.find(({ id }) => id === exportTable.id);
      expect(exportedTable?.fields.map(({ id }) => id)).toContain(retainedField.id);
      expect(exportedTable?.fields.map(({ id }) => id)).not.toContain(deletedField.id);

      await permanentDeleteTable(exportBaseRecord.id, exportTable.id);
    } finally {
      if (exportPath) {
        await app
          .get<StorageAdapter>(Symbol.for('ObjectStorage'))
          .deleteFile(StorageAdapter.getBucket(UploadType.ExportBase), exportPath)
          .catch(() => undefined);
      }
      await permanentDeleteBase(exportBaseRecord.id).catch(() => undefined);
    }
  });
});
