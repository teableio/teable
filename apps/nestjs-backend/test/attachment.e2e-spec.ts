import fs from 'fs';
import os from 'os';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { permanentDeleteTable, uploadAttachment } from '@teable/openapi';
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

  it('should upload attachment', async () => {
    const field = await createField(table.id, { name: 'field1', type: FieldType.Attachment });

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
  });
});
