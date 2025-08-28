/* eslint-disable sonarjs/no-duplicate-string */
import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentCellValue } from '@teable/core';
import { FieldType } from '@teable/core';
import { uploadAttachment, type ITableFullVo } from '@teable/openapi';
import { pick } from 'lodash';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import { getError } from './utils/get-error';
import {
  createBase,
  createRecords,
  createSpace,
  createTable,
  getRecords,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
  permanentDeleteTable,
} from './utils/init-app';

describe('Record Typecast', () => {
  let app: INestApplication;

  let baseId: string;
  let spaceId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    const space = await createSpace({
      name: 'test space Record Typecast',
    });
    spaceId = space.id;
    const base = await createBase({
      name: 'test base Record Typecast',
      spaceId,
    });
    baseId = base.id;
  });

  afterAll(async () => {
    await permanentDeleteBase(baseId);
    await permanentDeleteSpace(spaceId);
    await app.close();
  });

  describe('user fields', () => {
    let table: ITableFullVo;
    const userId = globalThis.testConfig.userId;
    const userName = globalThis.testConfig.userName;
    const userEmail = globalThis.testConfig.email;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'table1',
        fields: [
          {
            name: 'title',
            type: FieldType.SingleLineText,
          },
          {
            name: 'user',
            type: FieldType.User,
          },
        ],
        records: [],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('prefill user field', async () => {
      await createRecords(table.id, {
        records: [
          {
            fields: {
              [table.fields[1].id]: {
                id: userId,
                title: userName,
              },
            },
          },
        ],
      });

      const { records } = await getRecords(table.id);
      expect(records[0].fields.user).toEqual({
        id: userId,
        title: userName,
        email: userEmail,
        avatarUrl: expect.any(String),
      });
    });

    it('error when user not in table', async () => {
      const error = await getError(async () => {
        await createRecords(table.id, {
          records: [
            {
              fields: {
                [table.fields[1].id]: {
                  id: 'not-in-table',
                  title: 'not-in-table',
                },
              },
            },
          ],
        });
      });
      expect(error?.status).toBe(400);
      expect(error?.message).toContain('User(not-in-table) not selected in table');
    });

    it('error name and email', async () => {
      await createRecords(table.id, {
        records: [
          {
            fields: {
              [table.fields[1].id]: {
                id: userId,
                title: '11111',
                email: '11111',
              },
            },
          },
        ],
      });

      const { records } = await getRecords(table.id);
      expect(records[0].fields.user).toEqual({
        id: userId,
        title: userName,
        email: userEmail,
        avatarUrl: expect.any(String),
      });
    });
  });

  describe('attachment field', () => {
    let table: ITableFullVo;
    let tmpPath: string;
    beforeAll(async () => {
      tmpPath = path.resolve(
        path.join(StorageAdapter.TEMPORARY_DIR, `test-prefill-attachment-field.txt`)
      );
      fs.writeFileSync(tmpPath, 'xxxx');
    });

    afterAll(async () => {
      fs.unlinkSync(tmpPath);
    });

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'table1',
        fields: [
          {
            name: 'title',
            type: FieldType.SingleLineText,
          },
          {
            name: 'attachment',
            type: FieldType.Attachment,
          },
        ],
        records: [
          {
            fields: {
              title: 'title',
            },
          },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('prefill attachment field', async () => {
      const attachment = await uploadAttachment(
        table.id,
        table.records[0].id,
        table.fields[1].id,
        fs.createReadStream(tmpPath)
      ).then((res) => res.data);

      const cellValue = attachment.fields[table.fields[1].id] as IAttachmentCellValue;
      await createRecords(table.id, {
        records: [
          {
            fields: {
              [table.fields[1].id]: [
                {
                  path: 'xxxxx',
                  name: 'attachment',
                  id: 'actattachment-id',
                  size: 100,
                  mimetype: 'text/plain',
                  token: cellValue[0].token,
                },
              ],
            },
          },
        ],
      });

      const { records } = await getRecords(table.id);
      expect(records[1].fields.attachment).toHaveLength(1);
      expect(records[1].fields.attachment).toEqual([
        expect.objectContaining({
          ...pick(cellValue[0], ['token', 'path', 'size', 'mimetype']),
          name: 'attachment',
        }),
      ]);
    });

    it('error when attachment token not exist', async () => {
      const error = await getError(async () => {
        await createRecords(table.id, {
          records: [
            {
              fields: {
                [table.fields[1].id]: [
                  {
                    path: 'xxxxx',
                    name: 'attachment',
                    id: 'actattachment-id',
                    size: 100,
                    mimetype: 'text/plain',
                    token: 'not-exist-token',
                  },
                ],
              },
            },
          ],
        });
      });
      expect(error?.status).toBe(400);
      expect(error?.message).toContain('Attachment(not-exist-token) not found');
    });
  });
});
