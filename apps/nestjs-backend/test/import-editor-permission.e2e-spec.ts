import fs from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Role } from '@teable/core';
import type {
  ICreateBaseVo,
  ICreateSpaceVo,
  IRecordsVo,
  ITableFullVo,
  ITablePermissionVo,
  IUserMeVo,
} from '@teable/openapi';
import {
  CREATE_BASE,
  CREATE_SPACE,
  CREATE_TABLE,
  EMAIL_SPACE_INVITATION,
  GET_RECORDS_URL,
  GET_TABLE_PERMISSION,
  INPLACE_IMPORT_TABLE,
  NOTIFY_URL,
  PERMANENT_DELETE_SPACE,
  SIGNATURE_URL,
  SUPPORTEDTYPE,
  UploadType,
  urlBuilder,
  USER_ME,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import { CsvImporter } from '../src/features/import/open-api/import.class';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import { initApp } from './utils/init-app';

// Field names/values are neutral placeholders; the structure mirrors the report
// (one mappable single-line-text column + a created-by column, two data rows).
const csvContent = 'Name\nx\ny';
const ownerEmail = 'import.role.owner@example.com';
const editorEmail = 'import.role.editor@example.com';
const viewerEmail = 'import.role.viewer@example.com';
const password = '12345678';
const nameFieldName = 'Name';
const createdByFieldName = 'Created By';

describe('CSV append import permission (e2e)', () => {
  let app: INestApplication;
  let ownerAxios: AxiosInstance;
  let editorAxios: AxiosInstance;
  let viewerAxios: AxiosInstance;
  let spaceId: string;
  let baseId: string;
  let table: ITableFullVo;
  let attachmentUrl: string;
  let editor: IUserMeVo;

  const tempFilePath = path.resolve(
    path.join(StorageAdapter.TEMPORARY_DIR, 'import-editor-permission.csv')
  );

  const fieldIdByName = (name: string) => {
    const field = table.fields.find((item) => item.name === name);
    if (!field) {
      throw new Error(`field ${name} not found`);
    }
    return field.id;
  };

  const inplaceImportRo = () => ({
    attachmentUrl,
    fileType: SUPPORTEDTYPE.CSV,
    insertConfig: {
      sourceWorkSheetKey: CsvImporter.DEFAULT_SHEETKEY,
      excludeFirstRow: true,
      sourceColumnMap: {
        [fieldIdByName(nameFieldName)]: 0,
      },
    },
  });

  const getRecords = async (axiosInstance: AxiosInstance) => {
    const res = await axiosInstance.get<IRecordsVo>(
      urlBuilder(GET_RECORDS_URL, { tableId: table.id }),
      { params: { fieldKeyType: FieldKeyType.Id } }
    );
    return res.data.records;
  };

  const uploadCsv = async () => {
    fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
    fs.writeFileSync(tempFilePath, csvContent);
    const { size } = fs.statSync(tempFilePath);

    const { data: signature } = await ownerAxios.post<{
      token: string;
      requestHeaders: Record<string, unknown>;
    }>(SIGNATURE_URL, {
      type: UploadType.Import,
      contentLength: size,
      contentType: 'text/csv',
      baseId,
    });

    await ownerAxios.put(
      `/attachments/upload/${signature.token}`,
      fs.createReadStream(tempFilePath),
      {
        headers: { ...signature.requestHeaders },
      }
    );

    const { data } = await ownerAxios.post<{ presignedUrl: string }>(
      urlBuilder(NOTIFY_URL, { token: signature.token }),
      undefined,
      { params: { filename: 'a.csv' } }
    );
    return data.presignedUrl;
  };

  beforeAll(async () => {
    ({ app } = await initApp());

    ownerAxios = await createNewUserAxios({ email: ownerEmail, password });
    editorAxios = await createNewUserAxios({ email: editorEmail, password });
    viewerAxios = await createNewUserAxios({ email: viewerEmail, password });

    spaceId = (await ownerAxios.post<ICreateSpaceVo>(CREATE_SPACE, { name: 'import role space' }))
      .data.id;

    await ownerAxios.post(urlBuilder(EMAIL_SPACE_INVITATION, { spaceId }), {
      role: Role.Editor,
      emails: [editorEmail],
    });
    await ownerAxios.post(urlBuilder(EMAIL_SPACE_INVITATION, { spaceId }), {
      role: Role.Viewer,
      emails: [viewerEmail],
    });

    baseId = (await ownerAxios.post<ICreateBaseVo>(CREATE_BASE, { spaceId })).data.id;

    table = (
      await ownerAxios.post<ITableFullVo>(urlBuilder(CREATE_TABLE, { baseId }), {
        fields: [
          { name: nameFieldName, type: FieldType.SingleLineText },
          { name: createdByFieldName, type: FieldType.CreatedBy },
        ],
        records: [],
      })
    ).data;

    attachmentUrl = await uploadCsv();
    editor = (await editorAxios.get<IUserMeVo>(USER_ME)).data;
  });

  afterAll(async () => {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    if (spaceId) {
      await ownerAxios.delete(urlBuilder(PERMANENT_DELETE_SPACE, { spaceId }));
    }
    await app.close();
  });

  it('exposes the import permission to an editor and hides it from a viewer', async () => {
    const editorPermission = await editorAxios.get<ITablePermissionVo>(
      urlBuilder(GET_TABLE_PERMISSION, { baseId, tableId: table.id })
    );
    expect(editorPermission.data.table['table|import']).toBe(true);

    const viewerPermission = await viewerAxios.get<ITablePermissionVo>(
      urlBuilder(GET_TABLE_PERMISSION, { baseId, tableId: table.id })
    );
    expect(viewerPermission.data.table['table|import']).toBe(false);
  });

  it('lets an editor append CSV rows and records the editor as creator', async () => {
    const res = await editorAxios.patch<void>(
      urlBuilder(INPLACE_IMPORT_TABLE, { baseId, tableId: table.id }),
      inplaceImportRo()
    );
    expect(res.status).toBe(200);
    expect(res.headers['x-teable-v2']).toBe('true');

    const records = await getRecords(editorAxios);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.fields[fieldIdByName(nameFieldName)])).toEqual([
      'x',
      'y',
    ]);
    records.forEach((record) => {
      expect(record.fields[fieldIdByName(createdByFieldName)]).toMatchObject({
        id: editor.id,
        title: editor.name,
      });
    });
  });

  it('keeps the viewer out of the append import', async () => {
    const before = await getRecords(viewerAxios);

    const error = await getError(() =>
      viewerAxios.patch<void>(
        urlBuilder(INPLACE_IMPORT_TABLE, { baseId, tableId: table.id }),
        inplaceImportRo()
      )
    );
    expect(error?.status).toBe(403);
    expect(error?.code).toBe('restricted_resource');

    const after = await getRecords(viewerAxios);
    expect(after).toHaveLength(before.length);
  });
});
