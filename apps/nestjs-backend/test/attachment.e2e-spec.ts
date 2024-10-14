import fs from 'fs';
import os from 'os';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentCellValue } from '@teable/core';
import { FieldKeyType, FieldType, getRandomString } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { permanentDeleteTable, updateRecord, uploadAttachment } from '@teable/openapi';
import { createField, createTable, initApp } from './utils/init-app';

describe('OpenAPI AttachmentController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo;
  let filePath: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    const tempDir = os.tmpdir();
    filePath = path.join(tempDir, 'test-file.txt');
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

    const record1 = await uploadAttachment(table.id, table.records[0].id, field.id, fileContent);

    expect(record1.status).toBe(201);
    expect((record1.data.fields[field.id] as Array<object>).length).toEqual(1);

    const record2 = await uploadAttachment(
      table.id,
      table.records[0].id,
      field.id,
      'https://app.teable.io/favicon.ico'
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
    const imagePath = path.join(os.tmpdir(), `./${getRandomString(12)}.svg`);
    fs.writeFileSync(
      imagePath,
      `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="100" cy="100" r="80" fill="blue" />
  <rect x="60" y="60" width="80" height="80" fill="yellow" />
</svg>`
    );
    const imageStream = fs.createReadStream(imagePath);
    const field = await createField(table.id, { type: FieldType.Attachment });
    const record = await uploadAttachment(table.id, table.records[0].id, field.id, imageStream);
    fs.unlinkSync(imagePath);
    expect(record.data.fields[field.id] as IAttachmentCellValue[]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          smThumbnailUrl: expect.any(String),
          lgThumbnailUrl: expect.any(String),
          smThumbnailPath: expect.any(String),
          lgThumbnailPath: expect.any(String),
        }),
      ])
    );
  });
});
