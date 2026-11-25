import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { UpdateRecordsHandler } from '@teable/v2-core';
import { vi } from 'vitest';
import {
  createBase,
  createSpace,
  createTable,
  getRecords,
  initApp,
  permanentDeleteSpace,
  updateRecordByApi,
} from './utils/init-app';
import { requestPublicOrpc, signInPublicHost } from './utils/public-orpc';

describe('VCS push error responses', () => {
  let app: INestApplication;
  let appUrl: string;
  let spaceId: string;
  let baseId: string;
  let cookie: string;

  beforeAll(async () => {
    ({ app, appUrl } = await initApp());
    cookie = await signInPublicHost(appUrl);
    spaceId = (await createSpace({ name: 'VCS push errors' })).id;
    baseId = (await createBase({ spaceId, name: 'push errors' })).id;
  });

  afterAll(async () => {
    try {
      if (spaceId) await permanentDeleteSpace(spaceId);
    } finally {
      await app?.close();
    }
  });

  it('preserves disjoint writes and returns typed errors for rejected pushes', async () => {
    const post = (action: string, input: Record<string, unknown>) =>
      requestPublicOrpc(appUrl, `/bases/${baseId}/vcs/${action}`, input, { headers: { cookie } });
    const empty = { tablesAdded: [], tablesDeleted: [], tablesUpdated: [] };
    const disabled = await post('push', { baseRevision: 0, patch: empty });
    expect(disabled.status).toBe(409);
    expect(await disabled.json()).toMatchObject({ ok: false, error: { code: 'vcs.not_enabled' } });

    const table = await createTable(baseId, {
      name: 'Tasks',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: {} }, { fields: {} }],
    });
    const fieldId = table.fields[0].id;
    const [pushRecord, editedRecord] = (await getRecords(table.id)).records;
    const recordId = pushRecord.id;
    expect((await post('enable', {})).status).toBe(201);
    const ahead = await post('push', { baseRevision: 1, patch: empty });
    expect(ahead.status).toBe(409);
    expect(await ahead.json()).toMatchObject({
      ok: false,
      error: { code: 'vcs.non_fast_forward', details: { headRevision: 0 } },
    });

    const update = {
      tableId: table.id,
      fieldsAdded: [],
      fieldsUpdated: [],
      fieldsDeleted: [],
      viewsAdded: [],
      viewsUpdated: [],
      viewsDeleted: [],
      recordsAdded: [],
      recordsDeleted: [],
      recordsUpdated: [{ recordId, cellChanges: [{ fieldId, before: 'obsolete', after: 'new' }] }],
    };
    const stale = await post('push', {
      baseRevision: 0,
      patch: { ...empty, tablesUpdated: [update] },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      ok: false,
      error: {
        code: 'vcs.cas_conflict',
        details: { overlappingKeys: [`${table.id}:record:${recordId}:${fieldId}`] },
      },
    });

    const oversized = { ...update, recordsUpdated: Array(5001).fill(update.recordsUpdated[0]) };
    const large = await post('push', {
      baseRevision: 0,
      patch: { ...empty, tablesUpdated: [oversized] },
    });
    expect(large.status).toBe(400);
    expect(await large.json()).toMatchObject({
      ok: false,
      error: { code: 'vcs.patch_too_large_for_single_tx', details: { patchRecordOps: 5001 } },
    });

    const disjoint = {
      ...update,
      recordsUpdated: [{ recordId, cellChanges: [{ fieldId, before: null, after: 'pushed' }] }],
    };
    const [pushed] = await Promise.all([
      post('push', { baseRevision: 0, patch: { ...empty, tablesUpdated: [disjoint] } }),
      updateRecordByApi(table.id, editedRecord.id, fieldId, 'edited'),
    ]);
    expect(pushed.status).toBe(201);
    expect(await pushed.json()).toMatchObject({ newRevision: 1 });
    const live = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(live.records.map((row) => [row.id, row.fields[fieldId]])).toEqual(
      expect.arrayContaining([
        [recordId, 'pushed'],
        [editedRecord.id, 'edited'],
      ])
    );
  });

  it('returns a typed 503 when the write transaction exhausts its retries', async () => {
    const busyBase = await createBase({ spaceId, name: 'Retryable push' });
    const post = (action: string, input: Record<string, unknown>) =>
      requestPublicOrpc(appUrl, `/bases/${busyBase.id}/vcs/${action}`, input, {
        headers: { cookie },
      });
    const table = await createTable(busyBase.id, {
      name: 'Tasks',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: {} }],
    });
    const fieldId = table.fields[0].id;
    const recordId = (await getRecords(table.id)).records[0].id;
    expect((await post('enable', {})).status).toBe(201);

    const write = vi
      .spyOn(UpdateRecordsHandler.prototype, 'handle')
      .mockImplementation(async () => {
        throw Object.assign(new Error('synthetic SQL serialization failure'), { code: '40001' });
      });
    try {
      const response = await post('push', {
        baseRevision: 0,
        originPushId: 'vcsp_http_retryable_write',
        patch: {
          tablesAdded: [],
          tablesDeleted: [],
          tablesUpdated: [
            {
              tableId: table.id,
              fieldsAdded: [],
              fieldsUpdated: [],
              fieldsDeleted: [],
              viewsAdded: [],
              viewsUpdated: [],
              viewsDeleted: [],
              recordsAdded: [],
              recordsDeleted: [],
              recordsUpdated: [
                { recordId, cellChanges: [{ fieldId, before: null, after: 'new' }] },
              ],
            },
          ],
        },
      });
      expect(write).toHaveBeenCalledTimes(4);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        error: {
          code: 'vcs.write_busy',
          message: 'VCS write is temporarily busy. Retry the request.',
          tags: ['infrastructure'],
          details: { retryable: true },
        },
      });
    } finally {
      write.mockRestore();
    }
  });
});
