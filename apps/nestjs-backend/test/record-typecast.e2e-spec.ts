/* eslint-disable sonarjs/no-duplicate-string */
import fs from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentCellValue, IFieldVo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  axios,
  CREATE_FIELD,
  CREATE_RECORD,
  emailBaseInvitation,
  TEMPORARY_PASTE_URL,
  temporaryPaste,
  updateRecord,
  uploadAttachment,
  urlBuilder,
  USER_ME,
  X_CANARY_HEADER,
  type ITableFullVo,
  type IUserMeVo,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { pick } from 'lodash';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createBase,
  createField,
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
  const previousForceV2All = process.env.FORCE_V2_ALL;
  const previousEnableCanaryFeature = process.env.ENABLE_CANARY_FEATURE;

  beforeAll(async () => {
    process.env.FORCE_V2_ALL = 'false';
    process.env.ENABLE_CANARY_FEATURE = 'true';
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
    try {
      await permanentDeleteBase(baseId);
      await permanentDeleteSpace(spaceId);
      await app.close();
    } finally {
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
      if (previousEnableCanaryFeature == null) delete process.env.ENABLE_CANARY_FEATURE;
      else process.env.ENABLE_CANARY_FEATURE = previousEnableCanaryFeature;
    }
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
      expect(error?.message).toContain('User not found');
    });
  });

  describe('user identity objects over record HTTP', () => {
    const routes = [
      { version: 'v1', canary: 'false', responseV2: 'false' },
      { version: 'v2', canary: 'true', responseV2: 'true' },
    ] as const;
    const cases = routes.flatMap((route) =>
      [false, true].flatMap((isMultiple) =>
        [false, true].map((typecast) => ({ route, isMultiple, typecast }))
      )
    );
    let outsider: IUserMeVo;
    let secondCollaborator: IUserMeVo;
    let contractBaseId: string;

    beforeAll(async () => {
      const contractBase = await createBase({
        name: 'user identity HTTP routing',
        spaceId,
      });
      contractBaseId = contractBase.id;
      await app.get(PrismaService).base.update({
        where: { id: contractBaseId },
        data: { v2Enabled: false },
      });
      const outsiderClient = await createNewUserAxios({
        email: `record-typecast-outsider-${Date.now()}@test.com`,
        password: '12345678',
      });
      outsider = (await outsiderClient.get<IUserMeVo>(USER_ME)).data;
      const collaboratorClient = await createNewUserAxios({
        email: `record-typecast-collaborator-${Date.now()}@test.com`,
        password: '12345678',
      });
      secondCollaborator = (await collaboratorClient.get<IUserMeVo>(USER_ME)).data;
      await emailBaseInvitation({
        baseId: contractBaseId,
        emailBaseInvitationRo: { emails: [secondCollaborator.email], role: Role.Editor },
      });
    });

    afterAll(async () => {
      await permanentDeleteBase(contractBaseId);
    });

    it.each(routes)(
      '$version validates every single-user array collaborator independent of other rows',
      async (route) => {
        const table = await createTable(contractBaseId, {
          name: `single-user-array-${route.version}`,
          fields: [
            { name: 'title', type: FieldType.SingleLineText },
            {
              name: 'user',
              type: FieldType.User,
              options: { isMultiple: false, shouldNotify: false },
            },
          ],
          records: [],
        });
        try {
          const userFieldId = table.fields[1].id;
          const response = await axios.post(
            urlBuilder(CREATE_RECORD, { tableId: table.id }),
            {
              fieldKeyType: FieldKeyType.Id,
              typecast: true,
              records: [
                {
                  fields: {
                    [userFieldId]: [
                      { id: globalThis.testConfig.userId },
                      { id: secondCollaborator.id },
                    ],
                  },
                },
              ],
            },
            { headers: { [X_CANARY_HEADER]: route.canary }, validateStatus: () => true }
          );
          expect(response.headers['x-teable-v2']).toBe(route.responseV2);
          expect(response.status, JSON.stringify(response.data)).toBe(201);
          const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
          expect(records[0].fields[userFieldId]).toMatchObject({
            id: globalThis.testConfig.userId,
          });
          const rejected = await axios.post(
            urlBuilder(CREATE_RECORD, { tableId: table.id }),
            {
              fieldKeyType: FieldKeyType.Id,
              typecast: true,
              records: [
                {
                  fields: {
                    [userFieldId]: [{ id: globalThis.testConfig.userId }, { id: outsider.id }],
                  },
                },
                { fields: { [userFieldId]: { id: outsider.id, email: outsider.email } } },
              ],
            },
            { headers: { [X_CANARY_HEADER]: route.canary }, validateStatus: () => true }
          );
          expect(rejected.headers['x-teable-v2']).toBe(route.responseV2);
          expect(rejected.status).toBe(400);
          expect((await getRecords(table.id)).records).toHaveLength(1);
        } finally {
          await permanentDeleteTable(contractBaseId, table.id);
        }
      }
    );

    it.each(cases)(
      '$route.version accepts complete outsider identity and rejects ambiguous identities (multiple=$isMultiple, typecast=$typecast)',
      async ({ route, isMultiple, typecast }) => {
        const table = await createTable(contractBaseId, {
          name: `user-identity-${route.version}-${isMultiple}-${typecast}`,
          fields: [
            { name: 'title', type: FieldType.SingleLineText },
            {
              name: 'user',
              type: FieldType.User,
              options: { isMultiple, shouldNotify: false },
            },
          ],
          records: [],
        });
        const userFieldId = table.fields[1].id;
        const routeHeaders = { [X_CANARY_HEADER]: route.canary };
        const asCellValue = (value: unknown) => (isMultiple ? [value] : value);
        const postRecord = async (value: unknown) => {
          const response = await axios.post(
            urlBuilder(CREATE_RECORD, { tableId: table.id }),
            {
              fieldKeyType: FieldKeyType.Id,
              typecast,
              records: [{ fields: { [userFieldId]: asCellValue(value) } }],
            },
            { headers: routeHeaders, validateStatus: () => true }
          );
          expect(response.headers['x-teable-v2']).toBe(route.responseV2);
          return response;
        };

        try {
          const accepted = await postRecord({ id: outsider.id, email: outsider.email });
          expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);

          const mismatched = await postRecord({
            id: globalThis.testConfig.userId,
            email: outsider.email,
          });
          expect(mismatched.status, JSON.stringify(mismatched.data)).toBe(400);
          expect(mismatched.data).toMatchObject({
            data: { localization: { i18nKey: 'httpErrors.user.notFound' } },
          });

          const idOnly = await postRecord({ id: outsider.id });
          expect(idOnly.status, JSON.stringify(idOnly.data)).toBe(400);
          expect(idOnly.data).toMatchObject({
            data: { localization: { i18nKey: 'httpErrors.user.notFound' } },
          });

          const wrongCase = await postRecord({
            id: outsider.id,
            email: outsider.email.toUpperCase(),
          });
          expect(wrongCase.status).toBe(400);
          if (isMultiple) {
            const mixed = await axios.post(
              urlBuilder(CREATE_RECORD, { tableId: table.id }),
              {
                fieldKeyType: FieldKeyType.Id,
                typecast,
                records: [
                  {
                    fields: {
                      [userFieldId]: [
                        { id: outsider.id, email: outsider.email },
                        { id: outsider.id, email: 'incorrect@example.invalid' },
                      ],
                    },
                  },
                ],
              },
              { headers: routeHeaders, validateStatus: () => true }
            );
            expect(mixed.headers['x-teable-v2']).toBe(route.responseV2);
            expect(mixed.status).toBe(400);
          }

          const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
          expect(records).toHaveLength(1);
          const stored = records[0].fields[userFieldId];
          const storedOutsider = isMultiple ? (stored as unknown[])[0] : stored;
          expect(storedOutsider).toMatchObject({ id: outsider.id, email: outsider.email });
        } finally {
          await permanentDeleteTable(contractBaseId, table.id);
        }
      }
    );
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

  describe('single select field', () => {
    let table: ITableFullVo;
    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'table1',
        fields: [
          {
            name: 'title',
            type: FieldType.SingleLineText,
          },
          {
            name: 'singleSelect',
            type: FieldType.SingleSelect,
          },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should create a record with typecast', async () => {
      const record = await updateRecord(table.id, table.records[0].id, {
        record: {
          fields: {
            [table.fields[0].id]: 'select value',
            [table.fields[1].id]: '',
          },
        },
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
      }).then((res) => res.data);

      const emptySelectValue = record.fields[table.fields[1].id];
      expect(emptySelectValue === null || emptySelectValue === undefined).toBe(true);
    });
  });

  describe('cross-base link field', () => {
    let foreignBaseId: string;
    let foreignTable: ITableFullVo;
    let table: ITableFullVo;
    let linkField: IFieldVo;
    let editorUser: AxiosInstance;

    beforeAll(async () => {
      const foreignBase = await createBase({ name: 'typecast foreign base', spaceId });
      foreignBaseId = foreignBase.id;
      foreignTable = await createTable(foreignBaseId, {
        name: 'foreign',
        fields: [{ name: 'title', type: FieldType.SingleLineText }],
        records: [{ fields: { title: 'foreign-1' } }],
      });
      table = await createTable(baseId, {
        name: 'local',
        fields: [{ name: 'title', type: FieldType.SingleLineText }],
        records: [],
      });
      linkField = await createField(table.id, {
        name: 'link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
          baseId: foreignBaseId,
        },
      });

      // Editor on the local base only: no role at all on the foreign base.
      editorUser = await createNewUserAxios({
        email: `typecast-cross-base-${Date.now()}@test.com`,
        password: 'TestPassword123!',
      });
      const me = await editorUser.get<IUserMeVo>(USER_ME);
      await emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { emails: [me.data.email], role: Role.Editor },
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteBase(foreignBaseId);
    });

    it('resolves foreign titles for a user who can read the foreign base', async () => {
      const res = await temporaryPaste(table.id, {
        viewId: table.views[0].id,
        ranges: [
          [1, 0],
          [1, 0],
        ],
        content: 'foreign-1',
      });
      expect(res.status).toBe(200);
      expect(res.data[0].fields[linkField.id]).toMatchObject([{ id: foreignTable.records[0].id }]);
    });

    it('denies typecast into a foreign base the caller cannot read', async () => {
      const pasteError = await getError(() =>
        editorUser.patch(urlBuilder(TEMPORARY_PASTE_URL, { tableId: table.id }), {
          viewId: table.views[0].id,
          ranges: [
            [1, 0],
            [1, 0],
          ],
          content: 'foreign-1',
        })
      );
      expect(pasteError?.status).toBe(403);

      const createError = await getError(() =>
        editorUser.post(urlBuilder(CREATE_RECORD, { tableId: table.id }), {
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          records: [{ fields: { [linkField.id]: 'foreign-1' } }],
        })
      );
      expect(createError?.status).toBe(403);
    });

    it('decides cross-base by the linked table, not by the baseId in the options', async () => {
      const prisma = app.get(PrismaService);
      const stored = await prisma.field.findUniqueOrThrow({
        where: { id: linkField.id },
        select: { options: true },
      });
      const { baseId: _baseId, ...withoutBaseId } = JSON.parse(stored.options!);
      await prisma.field.update({
        where: { id: linkField.id },
        data: { options: JSON.stringify(withoutBaseId) },
      });
      try {
        const error = await getError(() =>
          editorUser.post(urlBuilder(CREATE_RECORD, { tableId: table.id }), {
            fieldKeyType: FieldKeyType.Id,
            typecast: true,
            records: [{ fields: { [linkField.id]: 'foreign-1' } }],
          })
        );
        expect(error?.status).toBe(403);
      } finally {
        await prisma.field.update({
          where: { id: linkField.id },
          data: { options: stored.options },
        });
      }
    });

    it('denies fields that read a foreign base the caller cannot read', async () => {
      const foreignTitleId = foreignTable.fields[0].id;
      const createFieldAs = (fieldRo: Record<string, unknown>) =>
        getError(() => editorUser.post(urlBuilder(CREATE_FIELD, { tableId: table.id }), fieldRo));
      const linkOptions = { relationship: Relationship.ManyMany, foreignTableId: foreignTable.id };

      for (const fieldRo of [
        { type: FieldType.Link, options: { ...linkOptions, baseId: foreignBaseId } },
        // leaving the baseId out must not make it look like a same-base link
        { type: FieldType.Link, options: linkOptions },
        {
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreignTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: foreignTitleId,
          },
        },
        {
          type: FieldType.ConditionalRollup,
          options: {
            baseId: foreignBaseId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignTitleId,
            expression: 'countall({values})',
          },
        },
      ]) {
        expect((await createFieldAs(fieldRo))?.status).toBe(403);
      }

      // the owner reads both bases
      const lookup = await createField(table.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: foreignTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: foreignTitleId,
        },
      });
      expect(lookup.isLookup).toBe(true);
    });
  });
});
