import type { INestApplication } from '@nestjs/common';
import type { IAttachmentCellValue, IRecord } from '@teable/core';
import { FieldKeyType, FieldType, Role, getRandomString } from '@teable/core';
import type { CreateAccessTokenVo, IUndoVo } from '@teable/openapi';
import {
  axios,
  createAccessToken,
  createAxios,
  deleteAccessToken,
  emailBaseInvitation,
  redo,
  undo,
  updateRecord,
  uploadAttachment,
  DELETE_USER,
} from '@teable/openapi';
import type { AxiosInstance, AxiosResponse } from 'axios';
import dayjs from 'dayjs';
import { X_TEABLE_UNDO_REDO_ENGINE_HEADER } from '../src/features/undo-redo/open-api/undo-redo.service';

import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createBase,
  createField,
  createRecords,
  createTable,
  getRecords,
  initApp,
  permanentDeleteBase,
  permanentDeleteTable,
} from './utils/init-app';

describe('order-only updateRecord (T8437)', () => {
  let app: INestApplication;
  let previousWindowId: (typeof axios.defaults.headers.common)[string];

  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  beforeEach(() => {
    previousWindowId = axios.defaults.headers.common['x-window-id'];
    axios.defaults.headers.common['x-window-id'] = `win${getRandomString(8)}`;
  });

  afterEach(() => {
    if (previousWindowId === undefined) {
      delete axios.defaults.headers.common['x-window-id'];
    } else {
      axios.defaults.headers.common['x-window-id'] = previousWindowId;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const createOrderedTable = async () => {
    const table = await createTable(baseId, {
      name: 'order-only update',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Notes', type: FieldType.SingleLineText },
      ],
      records: [],
    });
    const titleFieldId = table.fields[0].id;
    const notesFieldId = table.fields[1].id;

    try {
      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: ['Alpha', 'Beta', 'Gamma'].map((title) => ({
          fields: { [titleFieldId]: title, [notesFieldId]: `${title} notes` },
        })),
      });
      return { table, titleFieldId, notesFieldId, records: created.records };
    } catch (error) {
      await permanentDeleteTable(baseId, table.id);
      throw error;
    }
  };

  const titlesInView = async (tableId: string, viewId: string, titleFieldId: string) => {
    const { records } = await getRecords(tableId, {
      viewId,
      fieldKeyType: FieldKeyType.Id,
      take: 10,
    });
    return records.map((record) => record.fields[titleFieldId]);
  };

  it.each([FieldKeyType.Id, FieldKeyType.Name])(
    'preserves the full %s response and replays order-only, field-only and mixed updates',
    async (fieldKeyType) => {
      const { table, titleFieldId, notesFieldId, records } = await createOrderedTable();
      const [alpha, beta, gamma] = records;
      const viewId = table.views[0].id;
      const titleKey = fieldKeyType === FieldKeyType.Id ? titleFieldId : 'Title';
      const notesKey = fieldKeyType === FieldKeyType.Id ? notesFieldId : 'Notes';
      const originalOrder = [alpha.id, beta.id, gamma.id];
      const movedOrder = [beta.id, gamma.id, alpha.id];
      const expectState = async (order: string[], title = 'Alpha', notes = 'Alpha notes') => {
        const current = await getRecords(table.id, { viewId, fieldKeyType, take: 10 });
        expect(current.records.map(({ id }) => id)).toEqual(order);
        expect(current.records.find(({ id }) => id === alpha.id)).toMatchObject({
          id: alpha.id,
          name: title,
          fields: { [titleKey]: title, [notesKey]: notes },
        });
        expect(current.records.find(({ id }) => id === beta.id)?.fields).toEqual({
          [titleKey]: 'Beta',
          [notesKey]: 'Beta notes',
        });
        expect(current.records.find(({ id }) => id === gamma.id)?.fields).toEqual({
          [titleKey]: 'Gamma',
          [notesKey]: 'Gamma notes',
        });
        return current.records.find(({ id }) => id === alpha.id);
      };
      const expectResponse = (
        response: AxiosResponse<IRecord>,
        title = 'Alpha',
        notes = 'Alpha notes'
      ) => {
        expect(response.status).toBe(200);
        expect(response.headers['x-teable-v2']).toBe('true');
        expect(response.headers['x-teable-v2-feature']).toBe('updateRecord');
        expect(response.data.id).toBe(alpha.id);
        expect(response.data.fields).toEqual({ [titleKey]: title, [notesKey]: notes });
      };
      const expectReplay = (response: AxiosResponse<IUndoVo>) => {
        expect(response.data.status).toBe('fulfilled');
        expect(response.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v2');
        expect(response.headers['x-teable-v2']).toBe('true');
      };

      try {
        await expectState(originalOrder);
        const afterResponse = await updateRecord(table.id, alpha.id, {
          fieldKeyType,
          record: { fields: {} },
          order: { viewId, anchorId: gamma.id, position: 'after' },
        });
        expectResponse(afterResponse);
        expect(afterResponse.data.name).toBe('Alpha');
        expect(afterResponse.data).toEqual(await expectState(movedOrder));

        const beforeResponse = await updateRecord(table.id, alpha.id, {
          fieldKeyType,
          record: { fields: {} },
          order: { viewId, anchorId: beta.id, position: 'before' },
        });
        expectResponse(beforeResponse);
        expect(beforeResponse.data.name).toBe('Alpha');
        expect(beforeResponse.data).toEqual(await expectState(originalOrder));

        expectReplay(await undo(table.id));
        await expectState(movedOrder);
        expectReplay(await redo(table.id));
        await expectState(originalOrder);

        const fieldResponse = await updateRecord(table.id, alpha.id, {
          fieldKeyType,
          record: { fields: { [titleKey]: 'Alpha edited' } },
        });
        expectResponse(fieldResponse, 'Alpha edited');
        await expectState(originalOrder, 'Alpha edited');
        expectReplay(await undo(table.id));
        await expectState(originalOrder);
        expectReplay(await redo(table.id));
        await expectState(originalOrder, 'Alpha edited');

        const mixedResponse = await updateRecord(table.id, alpha.id, {
          fieldKeyType,
          record: { fields: { [notesKey]: 'Moved notes' } },
          order: { viewId, anchorId: gamma.id, position: 'after' },
        });
        expectResponse(mixedResponse, 'Alpha edited', 'Moved notes');
        await expectState(movedOrder, 'Alpha edited', 'Moved notes');
        expectReplay(await undo(table.id));
        await expectState(originalOrder, 'Alpha edited');
        expectReplay(await redo(table.id));
        await expectState(movedOrder, 'Alpha edited', 'Moved notes');
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );

  it('keeps uploaded attachment identity and usable URLs in Id and Name order-only responses', async () => {
    const { table, titleFieldId, records } = await createOrderedTable();
    const [alpha, beta, gamma] = records;
    const viewId = table.views[0].id;
    const contents = Buffer.from('T8437 real attachment contents');
    const anonymous = createAxios();

    try {
      const attachmentField = await createField(table.id, {
        name: 'File',
        type: FieldType.Attachment,
      });
      const uploaded = await uploadAttachment(table.id, alpha.id, attachmentField.id, contents, {
        filename: 'order-only.txt',
        contentType: 'text/plain',
      });
      expect(uploaded.status).toBe(201);
      const original = (uploaded.data.fields[attachmentField.id] as IAttachmentCellValue)[0];
      const identity = {
        id: original.id,
        token: original.token,
        name: 'order-only.txt',
        size: contents.length,
        mimetype: 'text/plain',
      };

      for (const { fieldKeyType, anchorId, position, expectedOrder } of [
        {
          fieldKeyType: FieldKeyType.Id,
          anchorId: gamma.id,
          position: 'after' as const,
          expectedOrder: ['Beta', 'Gamma', 'Alpha'],
        },
        {
          fieldKeyType: FieldKeyType.Name,
          anchorId: beta.id,
          position: 'before' as const,
          expectedOrder: ['Alpha', 'Beta', 'Gamma'],
        },
      ]) {
        const response = await updateRecord(table.id, alpha.id, {
          fieldKeyType,
          record: { fields: {} },
          order: { viewId, anchorId, position },
        });
        expect(response.status).toBe(200);
        expect(response.headers['x-teable-v2']).toBe('true');
        expect(response.data).toMatchObject({ id: alpha.id, name: 'Alpha' });
        const attachmentKey =
          fieldKeyType === FieldKeyType.Id ? attachmentField.id : attachmentField.name;
        const returned = response.data.fields[attachmentKey] as IAttachmentCellValue;
        expect(returned).toHaveLength(1);
        expect(returned[0]).toMatchObject(identity);
        expect(returned[0].presignedUrl).toEqual(expect.any(String));
        const downloadUrl = new URL(returned[0].presignedUrl!, axios.defaults.baseURL).href;
        const download = await anonymous.get(downloadUrl, { responseType: 'arraybuffer' });
        expect(download.status).toBe(200);
        expect(Buffer.from(download.data)).toEqual(contents);
        expect(await titlesInView(table.id, viewId, titleFieldId)).toEqual(expectedOrder);
      }
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('rejects viewers and unrelated users without moving the record', async () => {
    const { table, titleFieldId, records } = await createOrderedTable();
    const [alpha, , gamma] = records;
    const viewId = table.views[0].id;
    const order = { viewId, anchorId: gamma.id, position: 'after' as const };
    const viewerEmail = `order-viewer-${getRandomString(12)}@example.test`;
    const outsiderEmail = `order-outsider-${getRandomString(12)}@example.test`;
    const actors: AxiosInstance[] = [];

    try {
      const viewer = await createNewUserAxios({ email: viewerEmail, password: '12345678' });
      actors.push(viewer);
      await emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { emails: [viewerEmail], role: Role.Viewer },
      });
      const outsider = await createNewUserAxios({ email: outsiderEmail, password: '12345678' });
      actors.push(outsider);

      const viewerError = await getError(() =>
        viewer.patch(`/table/${table.id}/record/${alpha.id}`, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: {} },
          order,
        })
      );
      expect(viewerError?.status).toBe(403);
      expect(await titlesInView(table.id, viewId, titleFieldId)).toEqual([
        'Alpha',
        'Beta',
        'Gamma',
      ]);
      const outsiderError = await getError(() =>
        outsider.patch(`/table/${table.id}/record/${alpha.id}`, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: {} },
          order,
        })
      );

      expect(outsiderError?.status).toBe(403);
      expect(await titlesInView(table.id, viewId, titleFieldId)).toEqual([
        'Alpha',
        'Beta',
        'Gamma',
      ]);
    } finally {
      await Promise.all([
        permanentDeleteTable(baseId, table.id),
        ...actors.map((actor) => actor.delete(DELETE_USER, { params: { confirm: 'DELETE' } })),
      ]);
    }
  });

  it('requires the PAT update scope and target base, but not record read permission', async () => {
    const { table, titleFieldId, notesFieldId, records } = await createOrderedTable();
    const [alpha, , gamma] = records;
    const viewId = table.views[0].id;
    const tokens: CreateAccessTokenVo[] = [];
    let otherBaseId: string | undefined;
    const tokenAxios = createAxios();
    tokenAxios.defaults.baseURL = axios.defaults.baseURL;
    tokenAxios.defaults.headers.common['x-window-id'] = `win${getRandomString(8)}`;
    const body = {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: {} },
      order: { viewId, anchorId: gamma.id, position: 'after' as const },
    };
    const patch = (token: string) =>
      tokenAxios.patch<IRecord>(`/table/${table.id}/record/${alpha.id}`, body, {
        headers: { Authorization: `Bearer ${token}` },
      });

    try {
      const otherBase = await createBase({
        spaceId: globalThis.testConfig.spaceId,
        name: 'order-only PAT other base',
      });
      otherBaseId = otherBase.id;
      for (const { scopes, baseIds } of [
        { scopes: ['record|read'] as const, baseIds: [baseId] },
        { scopes: ['record|update'] as const, baseIds: [otherBase.id] },
        { scopes: ['table|read', 'record|update'] as const, baseIds: [baseId] },
      ]) {
        const { data: token } = await createAccessToken({
          name: 'order-only isolated token',
          scopes: [...scopes],
          baseIds,
          expiredTime: dayjs().add(1, 'day').format('YYYY-MM-DD'),
        });
        tokens.push(token);
      }

      for (const deniedToken of tokens.slice(0, 2)) {
        expect((await getError(() => patch(deniedToken.token)))?.status).toBe(403);
        expect(await titlesInView(table.id, viewId, titleFieldId)).toEqual([
          'Alpha',
          'Beta',
          'Gamma',
        ]);
      }

      const updateOnlyToken = tokens[2];
      expect(
        (
          await getError(() =>
            tokenAxios.get(`/table/${table.id}/record`, {
              headers: { Authorization: `Bearer ${updateOnlyToken.token}` },
            })
          )
        )?.status
      ).toBe(403);
      const response = await patch(updateOnlyToken.token);
      expect(response.status).toBe(200);
      expect(response.headers['x-teable-v2']).toBe('true');
      expect(response.data).toMatchObject({ id: alpha.id, name: 'Alpha' });
      expect(response.data.fields).toEqual({
        [titleFieldId]: 'Alpha',
        [notesFieldId]: 'Alpha notes',
      });
      expect(await titlesInView(table.id, viewId, titleFieldId)).toEqual([
        'Beta',
        'Gamma',
        'Alpha',
      ]);

      const undoResponse = await tokenAxios.post<IUndoVo>(
        `/table/${table.id}/undo-redo/undo`,
        undefined,
        { headers: { Authorization: `Bearer ${updateOnlyToken.token}` } }
      );
      expect(undoResponse.data.status).toBe('fulfilled');
      expect(undoResponse.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v2');
      expect(await titlesInView(table.id, viewId, titleFieldId)).toEqual([
        'Alpha',
        'Beta',
        'Gamma',
      ]);

      const redoResponse = await tokenAxios.post<IUndoVo>(
        `/table/${table.id}/undo-redo/redo`,
        undefined,
        { headers: { Authorization: `Bearer ${updateOnlyToken.token}` } }
      );
      expect(redoResponse.data.status).toBe('fulfilled');
      expect(redoResponse.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v2');
      expect(await titlesInView(table.id, viewId, titleFieldId)).toEqual([
        'Beta',
        'Gamma',
        'Alpha',
      ]);
    } finally {
      await Promise.all([
        ...tokens.map(({ id }) => deleteAccessToken(id)),
        permanentDeleteTable(baseId, table.id),
        ...(otherBaseId ? [permanentDeleteBase(otherBaseId)] : []),
      ]);
    }
  });
});
