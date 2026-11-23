import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { FieldType } from '@teable/core';
import { createAccessToken, deleteAccessToken, getField, refreshAccessToken, SUPPORTEDTYPE, updateAccessToken } from '@teable/openapi';
import type { IInplaceImportOptionRo, ITableFullVo } from '@teable/openapi';
import type { Queue } from 'bullmq';
import * as XLSX from 'xlsx';
import { V2_IMPORT_WORKFLOW_QUEUE } from '../src/features/v2/workflows/v2-import-workflow.types';
import { createBase, createSpace, createTable, initApp, permanentDeleteSpace } from './utils/init-app';
import { requestPublicOrpc, signInPublicHost } from './utils/public-orpc';
import { uploadPublicImport } from './utils/public-orpc-import';
import { splitAccessToken } from '../src/features/access-token/access-token.encryptor';

describe('public uploaded workflows with real parser and durable queue', () => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let spaceId: string;
  let baseId: string;
  let queue: Queue;
  const call = (name: string, input: Record<string, unknown>, headers: HeadersInit = { cookie }) =>
    requestPublicOrpc(appUrl, `/workflows/${name}`, input, { headers });
  const records = async (tableId: string) => {
    const response = await requestPublicOrpc(appUrl, '/tables/listRecords', { tableId }, {
      method: 'GET', headers: { cookie },
    });
    expect(response.status).toBe(200);
    return (await response.json()).data.records as Array<{ id: string; fields: Record<string, unknown> }>;
  };
  const capturedCredential = async (jobId: string, token: string) => {
    const job = await queue.getJob(jobId);
    expect(job).toBeDefined();
    const decoded = splitAccessToken(token);
    expect(decoded).not.toBeNull();
    const serialized = JSON.stringify(job!.data);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(decoded!.sign);
    expect(job!.data.credentialCeiling.signFingerprint).toMatch(/^[a-f0-9]{64}$/);
  };
  const terminal = async (tableId: string, status: 'completed' | 'failed') => {
    for (let round = 0; round < 240; round += 1) {
      const response = await call('getImportStatus', { tableId });
      expect(response.status).toBe(200);
      const current = (await response.json()).data;
      if (current.status === status) return current;
      if (['completed', 'failed'].includes(current.status)) throw new Error(`Unexpected terminal import status: ${JSON.stringify(current)}`);
      await delay(50);
    }
    throw new Error(`Real uploaded import job did not become ${status}`);
  };
  const inplaceOptions = async (table: ITableFullVo): Promise<IInplaceImportOptionRo> => {
    const source = await uploadPublicImport('Name\nfirst\nsecond\n', `inplace-${table.id}.csv`, 'text/csv', SUPPORTEDTYPE.CSV);
    return { attachmentUrl: source.attachmentUrl, fileType: source.fileType,
      insertConfig: { sourceWorkSheetKey: Object.keys(source.worksheets)[0], excludeFirstRow: true,
        sourceColumnMap: { [table.fields[0].id]: 0 } } };
  };
  beforeAll(async () => {
    ({ app, appUrl } = await initApp());
    cookie = await signInPublicHost(appUrl);
    spaceId = (await createSpace({ name: 'public native workflows' })).id;
    baseId = (await createBase({ spaceId, name: 'workflow records' })).id;
    queue = app.get<Queue>(getQueueToken(V2_IMPORT_WORKFLOW_QUEUE));
  });
  afterAll(async () => {
    try {
      await queue?.resume();
      if (spaceId) await permanentDeleteSpace(spaceId);
    } finally { await app?.close(); }
  });

  it('retains a mapped successful XLSX sheet when a later real sheet mapping is invalid', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Name', 'Score'], ['Ada', 5], ['Grace', 8],
    ]), 'Good');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Value'], ['bad mapping']]), 'Bad');
    const options = await uploadPublicImport(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
      'mapped-partial.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', SUPPORTEDTYPE.EXCEL);
    options.worksheets.Good.columns = [
      { name: 'Points', type: FieldType.Number, sourceColumnIndex: 1 },
      { name: 'Label', type: FieldType.SingleLineText, sourceColumnIndex: 0 },
    ];
    options.worksheets.Bad.columns = [{ name: 'Invalid source', type: FieldType.SingleLineText, sourceColumnIndex: -1 }];
    const response = await call('importTableFromFile', { baseId, options });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.sheets).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Good', importedCount: 2, truncated: false }),
      expect.objectContaining({ name: 'Bad', importedCount: 0, error: expect.any(String) }),
    ]));
    expect(body.data).toHaveLength(1);
    const imported = body.data[0] as ITableFullVo;
    const rows = await records(imported.id);
    expect(rows).toHaveLength(2);
    const points = imported.fields.find((field) => field.name === 'Points')!;
    const label = imported.fields.find((field) => field.name === 'Label')!;
    expect(rows.map((row) => [row.fields[points.id], row.fields[label.id]])).toEqual([[5, 'Ada'], [8, 'Grace']]);
  });

  it('returns a real durable job and truthful committed progress for successful inplace import', async () => {
    const table = await createTable(baseId, { name: 'successful real queued import',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }], records: [] });
    const response = await call('inplaceImportTableFromFile', { baseId, tableId: table.id, options: await inplaceOptions(table) });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({ tableId: table.id, jobId: expect.any(String) });
    const job = await queue.getJob(data.jobId);
    expect(job).toBeDefined();
    const status = await terminal(table.id, 'completed');
    expect(status.successCount).toBe(2);
    expect(await job!.getState()).toBe('completed');
    expect((await records(table.id)).map((row) => row.fields[table.fields[0].id])).toEqual(['first', 'second']);
  });

  it('refreshes a revoked initiating PAT before a paused real queue job can commit rows', async () => {
    const table = await createTable(baseId, { name: 'revoked queued import',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }], records: [] });
    const options = await inplaceOptions(table);
    const issued = (await createAccessToken({ name: 'revoke before import worker', description: 'fresh admission',
      scopes: ['table|import', 'record|create', 'record|read', 'table|read', 'field|read'],
      baseIds: [baseId],
      expiredTime: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    })).data;
    await queue.pause();
    let revoked = false;
    try {
      const response = await call('inplaceImportTableFromFile', { baseId, tableId: table.id, options }, {
        authorization: `Bearer ${issued.token}`,
      });
      expect(response.status).toBe(200);
      const { data } = await response.json();
      expect(await queue.getJob(data.jobId)).toBeDefined();
      const pending = await call('getImportStatus', { tableId: table.id });
      expect(pending.status).toBe(200);
      expect((await pending.json()).data.status).toBe('pending');
      expect(await records(table.id)).toHaveLength(0);
      await deleteAccessToken(issued.id);
      revoked = true;
      await queue.resume();
      const failed = await terminal(table.id, 'failed');
      expect(failed.message).toEqual(expect.any(String));
      expect(failed.successCount ?? 0).toBe(0);
      expect(await records(table.id)).toHaveLength(0);
      const job = await queue.getJob(data.jobId);
      expect(await job!.getState()).toBe('failed');
      expect(job!.attemptsMade).toBe(1);
    } finally {
      await queue.resume();
      if (!revoked) await deleteAccessToken(issued.id);
    }
  });

  it.each([false, true])('retains the captured PAT scope ceiling after same-id widening (nested field mutation: %s)', async (requiresFieldWrite) => {
    const table = await createTable(baseId, { name: `immutable queued scope ${requiresFieldWrite}`,
      fields: [{ name: 'Name', type: requiresFieldWrite ? FieldType.SingleSelect : FieldType.SingleLineText,
        ...(requiresFieldWrite ? { options: { choices: [{ name: 'existing' }] } } : {}) }], records: [] });
    const issued = (await createAccessToken({ name: 'capture original import scopes', description: 'immutable queued ceiling',
      scopes: ['table|import', 'record|create', 'record|read', 'table|read', 'field|read'],
      baseIds: [baseId],
      expiredTime: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    })).data;
    const beforeField = (await getField(table.id, table.fields[0].id)).data;
    await queue.pause();
    try {
      const queued = await call('inplaceImportTableFromFile', { baseId, tableId: table.id, options: await inplaceOptions(table) }, {
        authorization: `Bearer ${issued.token}`,
      });
      expect(queued.status).toBe(200);
      const { data } = await queued.json();
      await capturedCredential(data.jobId, issued.token);
      const pending = await call('getImportStatus', { tableId: table.id });
      expect(pending.status).toBe(200);
      expect((await pending.json()).data.status).toBe('pending');
      const widened = await updateAccessToken(issued.id, { name: 'widened same persisted token',
        scopes: ['table|import', 'record|create', 'record|read', 'table|read', 'field|read', 'field|update'],
        baseIds: [baseId] });
      expect(widened.data.id).toBe(issued.id);
      expect(widened.data.scopes).toContain('field|update');
      await queue.resume();
      const status = await terminal(table.id, requiresFieldWrite ? 'failed' : 'completed');
      if (requiresFieldWrite) {
        expect(status.message).toEqual(expect.any(String));
        expect(status.successCount ?? 0).toBe(0);
        expect(await records(table.id)).toHaveLength(0);
        expect((await getField(table.id, table.fields[0].id)).data.options).toEqual(beforeField.options);
      } else {
        expect(status.successCount).toBe(2);
        expect((await records(table.id)).map((row) => row.fields[table.fields[0].id])).toEqual(['first', 'second']);
      }
    } finally {
      await queue.resume();
      await deleteAccessToken(issued.id);
    }
  });

  it.each([false, true])('retains the original queued foreign-base ceiling after widening (originally allowed: %s)', async (originallyAllowed) => {
    const foreignBaseId = (await createBase({ spaceId, name: `foreign queued ceiling ${originallyAllowed}` })).id;
    const foreign = await createTable(foreignBaseId, { name: 'queued foreign lookup',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'QueuedForeignExisting' } }] });
    const table = await createTable(baseId, { name: `queued foreign source ${originallyAllowed}`,
      fields: [{ name: 'Name', type: FieldType.SingleLineText }], records: [] });
    const linkResponse = await requestPublicOrpc(appUrl, '/tables/createField', { baseId, tableId: table.id,
      field: { name: 'Foreign', type: 'link', options: { baseId: foreignBaseId, relationship: 'manyOne',
        foreignTableId: foreign.id, lookupFieldId: foreign.fields[0].id, isOneWay: true } } }, { headers: { cookie } });
    expect(linkResponse.status).toBe(200);
    const linked = (await linkResponse.json()).data.table;
    const linkId = linked.fields.find((field: { id: string; name: string }) => field.name === 'Foreign').id;
    const source = await uploadPublicImport('Name,Foreign\nQueuedSource,QueuedForeignExisting\n',
      `foreign-${table.id}.csv`, 'text/csv', SUPPORTEDTYPE.CSV);
    const options: IInplaceImportOptionRo = { attachmentUrl: source.attachmentUrl, fileType: source.fileType,
      insertConfig: { sourceWorkSheetKey: Object.keys(source.worksheets)[0], excludeFirstRow: true,
        sourceColumnMap: { [table.fields[0].id]: 0, [linkId]: 1 } } };
    const scopes = ['table|import', 'record|create', 'record|read', 'table|read', 'field|read'];
    const issued = (await createAccessToken({ name: 'capture foreign base ceiling', description: 'nested link scope', scopes,
      baseIds: originallyAllowed ? [baseId, foreignBaseId] : [baseId],
      expiredTime: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    })).data;
    await queue.pause();
    try {
      const queued = await call('inplaceImportTableFromFile', { baseId, tableId: table.id, options }, {
        authorization: `Bearer ${issued.token}` });
      expect(queued.status).toBe(200);
      const { data } = await queued.json();
      await capturedCredential(data.jobId, issued.token);
      const widened = await updateAccessToken(issued.id, { name: 'same token now includes foreign base', scopes,
        baseIds: [baseId, foreignBaseId] });
      expect(widened.data.id).toBe(issued.id);
      await queue.resume();
      const status = await terminal(table.id, originallyAllowed ? 'completed' : 'failed');
      const rows = await records(table.id);
      if (originallyAllowed) {
        expect(status.successCount).toBe(1);
        expect(rows).toHaveLength(1);
        expect(rows[0].fields[linkId]).toEqual(expect.objectContaining({ id: foreign.records[0].id }));
      } else {
        expect(status.successCount ?? 0).toBe(0);
        expect(status.message).toContain('Resource exceeds the queued import credential ceiling');
        expect(rows).toHaveLength(0);
      }
      expect(await records(foreign.id)).toHaveLength(1);
    } finally {
      await queue.resume();
      await deleteAccessToken(issued.id);
    }
  });

  it('rejects a rotated same-id PAT captured by an actual paused import job', async () => {
    const table = await createTable(baseId, { name: 'rotated queued import',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }], records: [] });
    const issued = (await createAccessToken({ name: 'rotate before import worker', description: 'credential provenance',
      scopes: ['table|import', 'record|create', 'record|read', 'table|read', 'field|read'],
      baseIds: [baseId],
      expiredTime: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
    })).data;
    await queue.pause();
    try {
      const queued = await call('inplaceImportTableFromFile', { baseId, tableId: table.id, options: await inplaceOptions(table) }, {
        authorization: `Bearer ${issued.token}`,
      });
      expect(queued.status).toBe(200);
      const { data } = await queued.json();
      expect(await queue.getJob(data.jobId)).toBeDefined();
      const rotated = (await refreshAccessToken(issued.id, { expiredTime: issued.expiredTime })).data;
      expect(rotated.id).toBe(issued.id);
      expect(rotated.token).not.toBe(issued.token);
      await queue.resume();
      const status = await terminal(table.id, 'failed');
      expect(status.message).toEqual(expect.any(String));
      expect(status.successCount ?? 0).toBe(0);
      expect(await records(table.id)).toHaveLength(0);
      expect(await (await queue.getJob(data.jobId))!.getState()).toBe('failed');
    } finally {
      await queue.resume();
      await deleteAccessToken(issued.id);
    }
  });
});
