import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, ViewType, generateFieldId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { deleteView, updateRecordOrders } from '@teable/openapi';
import type { IVcsRollbackOutput } from '@teable/v2-contract-http';
import type { IBaseVcsSnapshot, ITableVcsPatch } from '@teable/v2-vcs';
import {
  createBase,
  createRecords,
  createSpace,
  createTable,
  createView,
  deleteRecord,
  deleteTable,
  getFields,
  getRecords,
  getViews,
  initApp,
  permanentDeleteSpace,
  updateRecordByApi,
} from './utils/init-app';
import { requestPublicOrpc, signInPublicHost } from './utils/public-orpc';

describe('VCS rollback of deleted schema', () => {
  let app: INestApplication;
  let appUrl: string;
  let cookie: string;
  let spaceId: string;
  let baseId: string;

  beforeAll(async () => {
    ({ app, appUrl } = await initApp());
    cookie = await signInPublicHost(appUrl);
    spaceId = (await createSpace({ name: 'VCS field restoration' })).id;
  });

  beforeEach(async () => {
    baseId = (await createBase({ spaceId, name: 'Field history' })).id;
  });

  afterAll(async () => {
    try {
      if (spaceId) await permanentDeleteSpace(spaceId);
    } finally {
      await app?.close();
    }
  });

  const request = (path: string, input: Record<string, unknown>, method: 'GET' | 'POST' = 'POST') =>
    requestPublicOrpc(appUrl, `/bases/${baseId}/vcs/${path}`, input, {
      method,
      headers: { cookie },
    });
  it('restores the historical field ID and cell value while ordinary push rejects the tombstone', async () => {
    const table = await createTable(baseId, {
      name: 'Reviews',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Decision', type: FieldType.SingleLineText },
      ],
      records: [{ fields: {} }],
    });
    const fieldId = table.fields[1].id;
    const recordId = (await getRecords(table.id)).records[0].id;
    const push = async (baseRevision: number, changes: Partial<ITableVcsPatch>) => {
      const response = await request('push', {
        baseRevision,
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
              recordsUpdated: [],
              recordsDeleted: [],
              ...changes,
            },
          ],
        },
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ newRevision: baseRevision + 1 });
    };
    const checkout = async (revision: number) => {
      const response = await request('history/checkout', { revision }, 'GET');
      expect(response.status).toBe(200);
      const { snapshot } = (await response.json()) as { snapshot: IBaseVcsSnapshot };
      return snapshot.tables.find((item) => item.id === table.id)!;
    };

    expect((await request('enable', {})).status).toBe(201);
    await push(0, {
      recordsUpdated: [{ recordId, cellChanges: [{ fieldId, before: null, after: 'draft' }] }],
    });
    const historicalField = (await checkout(1)).fields.find((field) => field.id === fieldId)!;
    expect(historicalField.name).toBe('Decision');
    await push(1, {
      recordsUpdated: [
        { recordId, cellChanges: [{ fieldId, before: 'draft', after: 'approved' }] },
      ],
    });
    await push(2, { fieldsDeleted: [{ fieldId, before: historicalField }] });
    expect((await checkout(3)).fields.map((field) => field.id)).not.toContain(fieldId);
    const readMetadata = () =>
      app.get(PrismaService).field.findUniqueOrThrow({
        where: { id: fieldId },
        select: { tableId: true, deletedTime: true },
      });
    expect(await readMetadata()).toEqual({ tableId: table.id, deletedTime: expect.any(Date) });
    const replacementId = generateFieldId();
    await push(3, { fieldsAdded: [{ ...historicalField, id: replacementId }] });

    const response = await request('history/rollback', { revision: 1 });
    expect(response.status).toBe(200);
    const preview = (await response.json()) as IVcsRollbackOutput;
    if (!preview.dryRun) throw new Error('Expected a rollback preview');
    expect(preview.patch.tablesUpdated).toContainEqual(
      expect.objectContaining({
        tableId: table.id,
        fieldsAdded: [historicalField],
        fieldsDeleted: [expect.objectContaining({ fieldId: replacementId })],
        recordsUpdated: [{ recordId, cellChanges: [{ fieldId, before: null, after: 'draft' }] }],
      })
    );
    const ordinary = await request('push', { baseRevision: 4, patch: preview.patch });
    expect(ordinary.status).toBe(403);
    expect(await ordinary.json()).toMatchObject({ error: { code: 'vcs.cross_base_id_claimed' } });
    expect((await getFields(table.id)).map((field) => field.id)).not.toContain(fieldId);

    const confirmed = await request('history/rollback', {
      revision: 1,
      confirmation: preview.confirmation,
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ dryRun: false, result: { newRevision: 5 } });
    expect(await readMetadata()).toEqual({ tableId: table.id, deletedTime: null });
    const fields = await getFields(table.id);
    expect(fields).toContainEqual(expect.objectContaining({ id: fieldId, name: 'Decision' }));
    expect(fields.map((field) => field.id)).not.toContain(replacementId);
    const live = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(live.records.find((record) => record.id === recordId)?.fields[fieldId]).toBe('draft');
    const restored = await checkout(5);
    expect(restored.fields).toContainEqual(historicalField);
    expect(restored.records.find((record) => record.id === recordId)?.fields[fieldId]).toBe(
      'draft'
    );
  });

  it('restores default order after a row is re-created with the same ID', async () => {
    const table = await createTable(baseId, {
      name: 'Default order',
      records: [{ fields: {} }, { fields: {} }],
    });
    const primaryView = table.views[0].id;
    const manualView = (await createView(table.id, { name: 'Manual', type: ViewType.Grid })).id;
    const order = async (viewId: string) =>
      (await getRecords(table.id, { viewId })).records.map((row) => row.id);
    const [first, second] = await order(primaryView);
    expect((await request('enable', {})).status).toBe(201);
    await deleteRecord(table.id, first);
    const reinsert = await request('push', {
      baseRevision: 0,
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
            recordsAdded: [{ id: first, fields: {}, orders: { [manualView]: 0 } }],
            recordsUpdated: [],
            recordsDeleted: [],
          },
        ],
      },
    });
    expect(reinsert.status).toBe(201);
    expect(await order(primaryView)).toEqual([second, first]);
    expect(await order(manualView)).toEqual([first, second]);
    const preview = await request('history/rollback', { revision: 0 });
    expect(preview.status).toBe(200);
    const plan = (await preview.json()) as IVcsRollbackOutput;
    if (!plan.dryRun) throw new Error('Expected a rollback preview');
    const restored = await request('history/rollback', {
      revision: 0,
      confirmation: plan.confirmation,
    });
    expect(restored.status).toBe(200);
    expect(await order(primaryView)).toEqual([first, second]);
    expect(await order(manualView)).toEqual([first, second]);
  });

  it.each([false, true])('restores exact row orders (trashed=%s)', async (trashed) => {
    const table = await createTable(baseId, {
      name: 'Queue',
      records: [{ fields: {} }, { fields: {} }, { fields: {} }],
    });
    const manual = table.views[0].id;
    const other = (await createView(table.id, { name: 'Second queue', type: ViewType.Grid })).id;
    const fresh = (await createView(table.id, { name: 'Third queue', type: ViewType.Grid })).id;
    const readOrder = async (viewId: string) =>
      (await getRecords(table.id, { viewId })).records.map((row) => row.id);
    const [a, b, c] = await readOrder(manual);
    const moveBefore = (viewId: string, anchorId: string, recordIds: string[]) =>
      updateRecordOrders(table.id, viewId, { anchorId, recordIds, position: 'before' });
    const checkpoint = async (revision: number) => {
      const response = await request('history/checkout', { revision }, 'GET');
      expect(response.status).toBe(200);
      const { snapshot } = (await response.json()) as { snapshot: IBaseVcsSnapshot };
      return snapshot.tables.find((item) => item.id === table.id)!.records;
    };

    await moveBefore(manual, a, [c]);
    expect(await readOrder(manual)).toEqual([c, a, b]);
    expect(await readOrder(other)).toEqual([a, b, c]);
    expect((await request('enable', {})).status).toBe(201);
    const target = await checkpoint(0);
    for (const row of target) expect(row.orders?.[manual]).toEqual(expect.any(Number));

    await moveBefore(manual, c, [a, b]);
    await moveBefore(other, a, [b, c]);
    expect(await readOrder(manual)).toEqual([a, b, c]);
    expect(await readOrder(other)).toEqual([b, c, a]);
    if (trashed) {
      await deleteRecord(table.id, c);
      await deleteTable(baseId, table.id, 200);
    }

    const response = await request('history/rollback', { revision: 0 });
    expect(response.status).toBe(200);
    const preview = (await response.json()) as IVcsRollbackOutput;
    if (!preview.dryRun) throw new Error('Expected a rollback preview');
    if (!trashed) {
      const updates = preview.patch.tablesUpdated.find((item) => item.tableId === table.id)!;
      expect(updates.recordsUpdated.map((row) => row.recordId).sort()).toEqual([a, b, c].sort());
      for (const row of updates.recordsUpdated) {
        expect(row.cellChanges).toEqual([]);
        expect(row.orderChanges?.length).toBeGreaterThan(0);
      }
    }
    const confirmed = await request('history/rollback', {
      revision: 0,
      confirmation: preview.confirmation,
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ result: { newRevision: 1 } });
    expect(await readOrder(manual)).toEqual([c, a, b]);
    expect(await readOrder(other)).toEqual([a, b, c]);

    const restored = new Map((await checkpoint(1)).map((row) => [row.id, row]));
    for (const row of target) {
      const actual = restored.get(row.id)!;
      expect(actual.orders?.[manual]).toBe(row.orders![manual]);
      expect(actual.orders?.[other]).toBe(row.orders?.[other] ?? row.autoNumber);
    }
    if (!trashed) {
      const stale = await request('push', { baseRevision: 1, patch: preview.patch });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({
        error: {
          code: 'vcs.cas_conflict',
          details: {
            overlappingKeys: expect.arrayContaining([`${table.id}:record:${a}:order:${manual}`]),
          },
        },
      });

      const row = target.find((item) => item.id === b)!;
      const first = target.find((item) => item.id === a)!;
      const before = row.orders?.[fresh] ?? row.autoNumber!;
      const after = (first.orders?.[fresh] ?? first.autoNumber!) - 0.25;
      const orderOnly = {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            tableId: table.id,
            fieldsAdded: [],
            fieldsDeleted: [],
            fieldsUpdated: [],
            viewsAdded: [],
            viewsDeleted: [],
            viewsUpdated: [],
            recordsAdded: [],
            recordsDeleted: [],
            recordsUpdated: [
              { recordId: b, cellChanges: [], orderChanges: [{ viewId: fresh, before, after }] },
            ],
          },
        ],
      };
      expect((await request('push', { baseRevision: 1, patch: orderOnly })).status).toBe(201);
      expect(await readOrder(fresh)).toEqual([b, a, c]);
      expect((await checkpoint(2)).find((item) => item.id === b)?.orders?.[fresh]).toBe(after);
      const comparison = await request('history/diff', { from: 1, to: 2 }, 'GET');
      expect(comparison.status).toBe(200);
      expect(await comparison.json()).toMatchObject({
        patch: orderOnly,
        summary: { recordsUpdated: 1, cellChanges: 0 },
      });
    }
  });

  it('recovers a deleted table with its historical values and a deleted view on a live table', async () => {
    const table = await createTable(baseId, {
      name: 'Releases',
      fields: [{ name: 'Status', type: FieldType.SingleLineText }],
      records: [{ fields: {} }],
    });
    const other = await createTable(baseId, { name: 'Dashboard', records: [] });
    const view = await createView(other.id, { name: 'Overview', type: ViewType.Grid });
    const fieldId = table.fields[0].id;
    const recordId = (await getRecords(table.id)).records[0].id;
    await updateRecordByApi(table.id, recordId, fieldId, 'initial');
    expect((await request('enable', {})).status).toBe(201);

    await updateRecordByApi(table.id, recordId, fieldId, 'updated');
    await deleteTable(baseId, table.id, 200);
    await deleteView(other.id, view.id);
    const replacement = await createView(other.id, { name: view.name, type: ViewType.Grid });
    expect((await getViews(other.id)).map((v) => v.id)).not.toContain(view.id);
    const previewResponse = await request('history/rollback', { revision: 0 });
    expect(previewResponse.status).toBe(200);
    const preview = (await previewResponse.json()) as IVcsRollbackOutput;
    if (!preview.dryRun) throw new Error('Expected a rollback preview');
    expect(preview.patch.tablesAdded.map((t) => t.id)).toContain(table.id);
    expect(
      preview.patch.tablesUpdated.find((t) => t.tableId === other.id)?.viewsAdded
    ).toContainEqual(expect.objectContaining({ id: view.id }));
    const confirmed = await request('history/rollback', {
      revision: 0,
      confirmation: preview.confirmation,
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ dryRun: false, result: { newRevision: 1 } });
    const live = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(live.records.map((r) => [r.id, r.fields[fieldId]])).toEqual([[recordId, 'initial']]);
    const views = await getViews(other.id);
    expect(views).toContainEqual(expect.objectContaining({ id: view.id, name: view.name }));
    expect(views.map((v) => v.id)).not.toContain(replacement.id);
  });

  it.each([true, false])(
    'counts retained row changes for rollback (rows at checkpoint: %s)',
    async (presentAtCheckpoint) => {
      const rows = [{ fields: {} }, { fields: {} }];
      const table = await createTable(baseId, {
        name: 'Retained records',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: presentAtCheckpoint ? rows : [],
      });
      expect((await request('enable', {})).status).toBe(201);
      if (!presentAtCheckpoint) await createRecords(table.id, { records: rows });
      const ids = (await getRecords(table.id)).records.map((r) => r.id).sort();
      expect(ids).toHaveLength(2);
      await deleteTable(baseId, table.id, 200);
      vi.stubEnv('TEABLE_VCS_MAX_SINGLE_TX_PUSH_OPS', '1');
      try {
        const response = await request('history/rollback', { revision: 0 });
        if (!presentAtCheckpoint) {
          expect(response.status).toBe(400);
          expect(await response.json()).toMatchObject({
            error: { code: 'vcs.patch_too_large_for_single_tx' },
          });
          const head = await request('head', {}, 'GET');
          expect(await head.json()).toMatchObject({ headRevision: 0 });
          return;
        }
        expect(response.status).toBe(200);
        const preview = (await response.json()) as IVcsRollbackOutput;
        if (!preview.dryRun) throw new Error('Expected a rollback preview');
        const restored = await request('history/rollback', {
          revision: 0,
          confirmation: preview.confirmation,
        });
        expect(restored.status).toBe(200);
        expect((await getRecords(table.id)).records.map((r) => r.id).sort()).toEqual(ids);
      } finally {
        vi.unstubAllEnvs();
      }
    }
  );
});
