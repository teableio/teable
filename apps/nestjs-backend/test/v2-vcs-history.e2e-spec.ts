import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import type { IVcsHistoryDiffOutput, IVcsRollbackOutput } from '@teable/v2-contract-http';
import type { IBaseVcsSnapshot } from '@teable/v2-vcs';
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

describe('Base VCS revision history', () => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let spaceId: string;
  let baseId: string;
  let tableId: string;
  let fieldId: string;
  let recordId: string;

  const request = (path: string, input: Record<string, unknown>, method: 'GET' | 'POST') =>
    requestPublicOrpc(appUrl, `/bases/${baseId}/vcs/${path}`, input, {
      method,
      headers: { cookie },
    });

  async function pushCell(baseRevision: number, before: string | null, after: string) {
    const response = await request(
      'push',
      {
        baseRevision,
        patch: {
          tablesAdded: [],
          tablesDeleted: [],
          tablesUpdated: [
            {
              tableId,
              fieldsAdded: [],
              fieldsUpdated: [],
              fieldsDeleted: [],
              viewsAdded: [],
              viewsUpdated: [],
              viewsDeleted: [],
              recordsAdded: [],
              recordsDeleted: [],
              recordsUpdated: [{ recordId, cellChanges: [{ fieldId, before, after }] }],
            },
          ],
        },
      },
      'POST'
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ newRevision: baseRevision + 1 });
  }

  async function readRevision(revision: number) {
    const response = await request('history/checkout', { revision }, 'GET');
    expect(response.status).toBe(200);
    const { snapshot } = (await response.json()) as { snapshot: IBaseVcsSnapshot };
    expect(snapshot.revision).toBe(revision);
    return snapshot.tables
      .find((table) => table.id === tableId)
      ?.records.find((record) => record.id === recordId)?.fields[fieldId];
  }

  async function previewRestore(revision: number) {
    const response = await request('history/rollback', { revision }, 'POST');
    expect(response.status).toBe(200);
    const preview = (await response.json()) as IVcsRollbackOutput;
    if (!preview.dryRun) throw new Error('Rollback without confirmation applied a change');
    return preview;
  }

  beforeAll(async () => {
    ({ app, appUrl } = await initApp());
    cookie = await signInPublicHost(appUrl);
    spaceId = (await createSpace({ name: 'VCS history' })).id;
    baseId = (await createBase({ spaceId, name: 'Immutable revisions' })).id;
    const table = await createTable(baseId, {
      name: 'Releases',
      fields: [{ name: 'Status', type: FieldType.SingleLineText }],
      records: [{ fields: {} }],
    });
    tableId = table.id;
    fieldId = table.fields[0].id;
    recordId = (await getRecords(tableId)).records[0].id;
  });

  afterAll(async () => {
    try {
      if (spaceId) await permanentDeleteSpace(spaceId);
    } finally {
      await app?.close();
    }
  });

  it('rejects incomplete revision comparisons and reports a missing checkout without substituting live data', async () => {
    expect((await request('history/diff', { from: 0 }, 'GET')).status).toBe(400);
    expect((await request('history/checkout', { revision: -1 }, 'GET')).status).toBe(400);
    const unavailable = await request('history/checkout', { revision: 99999 }, 'GET');
    expect(unavailable.status).toBe(404);
  });

  it('preserves prior revisions and rejects a stale rollback before committing its inverse at a new head', async () => {
    expect((await request('enable', {}, 'POST')).status).toBe(201);
    await pushCell(0, null, 'draft');
    await pushCell(1, 'draft', 'review');
    const stale = await previewRestore(1);
    expect(stale.headRevision).toBe(2);
    await pushCell(2, 'review', 'released');
    expect(await readRevision(1)).toBe('draft');
    expect(await readRevision(3)).toBe('released');
    const comparison = await request('history/diff', { from: 1, to: 3 }, 'GET');
    expect(comparison.status).toBe(200);
    const diff = (await comparison.json()) as IVcsHistoryDiffOutput;
    expect(diff).toMatchObject({ from: 1, to: 3, mergeBase: 1, summary: { cellChanges: 1 } });
    expect(diff.patch.tablesUpdated[0].recordsUpdated).toEqual([
      { recordId, cellChanges: [{ fieldId, before: 'draft', after: 'released' }] },
    ]);
    const rejected = await request(
      'history/rollback',
      { revision: 1, confirmation: stale.confirmation },
      'POST'
    );
    expect(rejected.status).toBe(409);
    const preview = await previewRestore(1);
    expect(preview).toMatchObject({ headRevision: 3, revision: 1, summary: { cellChanges: 1 } });
    const confirm = {
      revision: 1,
      confirmation: preview.confirmation,
      originPushId: 'history-confirm-1',
    };
    const first = await request('history/rollback', confirm, 'POST');
    expect(first.status).toBe(200);
    const receipt = await first.json();
    expect(receipt).toMatchObject({
      dryRun: false,
      result: { newRevision: 4, commitId: expect.any(String) },
    });
    const retry = await request('history/rollback', confirm, 'POST');
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(receipt);
    expect(await readRevision(4)).toBe('draft');
    expect(await readRevision(3)).toBe('released');
    const live = await getRecords(tableId, { fieldKeyType: FieldKeyType.Id });
    expect(live.records[0].fields[fieldId]).toBe('draft');

    const beforeEdit = await previewRestore(3);
    await updateRecordByApi(tableId, recordId, fieldId, 'hotfix');
    const afterEdit = await request(
      'history/rollback',
      {
        revision: 3,
        confirmation: beforeEdit.confirmation,
        originPushId: 'history-after-business-edit',
      },
      'POST'
    );
    expect(afterEdit.status).toBe(409);
    const afterConflict = await getRecords(tableId, { fieldKeyType: FieldKeyType.Id });
    expect(afterConflict.records[0].fields[fieldId]).toBe('hotfix');
    expect(await readRevision(4)).toBe('draft');
  });
});
