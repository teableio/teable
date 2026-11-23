import { createHeadlessRuntime } from '@teable/v2-headless-runtime';
import type { IBaseVcsSnapshot } from '@teable/v2-vcs';
import { describe, expect, it } from 'vitest';

import { createHeadlessHttpApp } from './index';

const BASE_ID = 'bsecompat0000000001';

const actorHeaders = (actor = 'usr_compat'): Headers => {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.set('x-teable-actor', actor);
  return headers;
};

describe('headless-http OpenAPI v1 compatibility and /api/v2/* proxy', () => {
  it('supports base, table, field, record, view CRUD, upsert, /api/v2/* cascades, and /vcs/snapshot', async () => {
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
    });
    const app = createHeadlessHttpApp(runtime, {
      defaultActorId: 'usr_compat',
      defaultBaseId: BASE_ID,
      defaultBaseName: 'Local Compat Base',
    });

    try {
      const headers = actorHeaders();

      // 1. Base info & permissions
      const baseRes = await app.request(`/api/base/${BASE_ID}`, { headers });
      expect(baseRes.status).toBe(200);
      expect(await baseRes.json()).toMatchObject({
        id: BASE_ID,
        name: 'Local Compat Base',
        spaceId: 'spc_local_vcs',
        collaboratorType: 'owner',
        role: 'owner',
      });

      const basePermRes = await app.request(`/api/base/${BASE_ID}/permission`, { headers });
      expect(basePermRes.status).toBe(200);
      const basePerm = (await basePermRes.json()) as Record<string, boolean>;
      expect(basePerm['base|read']).toBe(true);
      expect(basePerm['table|create']).toBe(true);
      expect(basePerm['field|update']).toBe(true);
      expect(basePerm['record|delete']).toBe(true);
      expect(basePerm['view|create']).toBe(true);

      // 2. Create table via OpenAPI trailing-slash route with name/fields/views
      const createTableRes = await app.request(`/api/base/${BASE_ID}/table/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Orders',
          icon: '🧾',
          description: 'Initial orders',
          fields: [
            { name: 'Code', type: 'singleLineText', unique: true, isPrimary: true },
            {
              name: 'Price',
              type: 'number',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
            { name: 'Notes', type: 'singleLineText' },
          ],
          views: [{ type: 'grid', name: 'Main Grid' }],
        }),
      });
      expect(createTableRes.status).toBe(201);
      const createdTable = (await createTableRes.json()) as {
        id: string;
        name: string;
        dbTableName: string;
        defaultViewId: string;
        fields: Array<{
          id: string;
          name: string;
          type: string;
          dbFieldName: string;
          isPrimary?: boolean;
        }>;
        views: Array<{ id: string; name: string; type: string }>;
        records: unknown[];
      };
      expect(createdTable.name).toBe('Orders');
      expect(createdTable.defaultViewId).toBe(createdTable.views[0]?.id);
      expect(createdTable.fields.length).toBe(3);
      expect(createdTable.fields.every((f) => Boolean(f.dbFieldName))).toBe(true);
      expect(createdTable.fields[0]?.isPrimary).toBe(true);

      const tableId = createdTable.id;
      const codeField = createdTable.fields.find((f) => f.name === 'Code')!;
      const priceField = createdTable.fields.find((f) => f.name === 'Price')!;
      const notesField = createdTable.fields.find((f) => f.name === 'Notes')!;

      // Table permissions + summary list + get table + rename/description/icon
      const tablePermRes = await app.request(`/api/base/${BASE_ID}/table/${tableId}/permission`, {
        headers,
      });
      expect(tablePermRes.status).toBe(200);
      const tablePerm = (await tablePermRes.json()) as {
        table: Record<string, boolean>;
        view: Record<string, boolean>;
        record: Record<string, boolean>;
        field: Record<string, boolean>;
      };
      expect(tablePerm.table['table|update']).toBe(true);
      expect(tablePerm.record['record|create']).toBe(true);

      expect(
        (
          await app.request(`/api/base/${BASE_ID}/table/${tableId}/name`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ name: 'Orders V2' }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await app.request(`/api/base/${BASE_ID}/table/${tableId}/description`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ description: 'Updated orders' }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await app.request(`/api/base/${BASE_ID}/table/${tableId}/icon`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ icon: '📦' }),
          })
        ).status
      ).toBe(200);

      const listTablesRes = await app.request(`/api/base/${BASE_ID}/table`, { headers });
      expect(listTablesRes.status).toBe(200);
      const listedTables = (await listTablesRes.json()) as Array<{
        id: string;
        name: string;
        description?: string;
        icon?: string;
        defaultViewId?: string;
      }>;
      expect(listedTables).toHaveLength(1);
      expect(listedTables[0]).toMatchObject({
        id: tableId,
        name: 'Orders V2',
        description: 'Updated orders',
        icon: '📦',
        defaultViewId: createdTable.defaultViewId,
      });

      const getTableRes = await app.request(`/api/base/${BASE_ID}/table/${tableId}`, { headers });
      expect(getTableRes.status).toBe(200);
      expect((await getTableRes.json()) as { name: string }).toMatchObject({ name: 'Orders V2' });

      // 3. Field CRUD: create formula, create temp field -> patch -> convert -> delete
      const formulaRes = await app.request(`/api/table/${tableId}/field`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'DoublePrice',
          type: 'formula',
          options: {
            expression: `{${priceField.id}} * 2`,
            timeZone: 'UTC',
          },
        }),
      });
      expect(formulaRes.status).toBe(201);
      const formulaField = (await formulaRes.json()) as {
        id: string;
        name: string;
        type: string;
        isComputed?: boolean;
        dbFieldName: string;
      };
      expect(formulaField.type).toBe('formula');
      expect(formulaField.isComputed).toBe(true);
      expect(formulaField.dbFieldName).toBeTruthy();

      const patchNotesRes = await app.request(`/api/table/${tableId}/field/${notesField.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: 'Remarks', description: 'Converted soon' }),
      });
      expect(patchNotesRes.status).toBe(200);
      expect(await patchNotesRes.json()).toMatchObject({ id: notesField.id, name: 'Remarks' });

      const convertRes = await app.request(`/api/table/${tableId}/field/${notesField.id}/convert`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: 'Quantity',
          type: 'number',
          options: { formatting: { type: 'decimal', precision: 0 } },
        }),
      });
      expect(convertRes.status).toBe(200);
      expect(await convertRes.json()).toMatchObject({
        id: notesField.id,
        name: 'Quantity',
        type: 'number',
      });

      const tempFieldRes = await app.request(`/api/table/${tableId}/field`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Temp', type: 'checkbox' }),
      });
      expect(tempFieldRes.status).toBe(201);
      const tempField = (await tempFieldRes.json()) as { id: string };

      const getFieldRes = await app.request(`/api/table/${tableId}/field/${tempField.id}`, {
        headers,
      });
      expect(getFieldRes.status).toBe(200);

      expect(
        (
          await app.request(`/api/table/${tableId}/field/${tempField.id}`, {
            method: 'DELETE',
            headers,
          })
        ).status
      ).toBe(200);

      const getFieldsRes = await app.request(`/api/table/${tableId}/field`, { headers });
      expect(getFieldsRes.status).toBe(200);
      const currentFields = (await getFieldsRes.json()) as Array<{ id: string; name: string }>;
      expect(currentFields.map((f) => f.name)).not.toContain('Temp');

      // 4. Record CRUD: POST default fieldKeyType ('name'), GET with omitted 'name' vs 'id', PATCH single & batch, upsert
      const createRecRes = await app.request(`/api/table/${tableId}/record`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          records: [
            { fields: { Code: 'ORD-1', Price: 15 } },
            { fields: { Code: 'ORD-2', Price: 25 } },
          ],
        }),
      });
      expect(createRecRes.status).toBe(201);
      const createdRecBody = (await createRecRes.json()) as {
        records: Array<{ id: string; fields: Record<string, unknown> }>;
      };
      expect(createdRecBody.records).toHaveLength(2);
      expect(createdRecBody.records[0]?.fields.DoublePrice).toBe(30);
      expect(createdRecBody.records[1]?.fields.DoublePrice).toBe(50);

      const rec1Id = createdRecBody.records[0]!.id;
      const rec2Id = createdRecBody.records[1]!.id;

      // Default fieldKeyType=name on GET list & single
      const getRecsNameRes = await app.request(`/api/table/${tableId}/record`, { headers });
      expect(getRecsNameRes.status).toBe(200);
      const getRecsNameBody = (await getRecsNameRes.json()) as {
        records: Array<{ id: string; fields: Record<string, unknown> }>;
      };
      expect(getRecsNameBody.records.find((r) => r.id === rec1Id)?.fields).toMatchObject({
        Code: 'ORD-1',
        Price: 15,
        DoublePrice: 30,
      });

      // Explicit fieldKeyType=id with projection & pagination
      const getRecIdRes = await app.request(
        `/api/table/${tableId}/record/${rec1Id}?fieldKeyType=id`,
        { headers }
      );
      expect(getRecIdRes.status).toBe(200);
      const singleById = (await getRecIdRes.json()) as {
        id: string;
        fields: Record<string, unknown>;
      };
      expect(singleById.fields[priceField.id]).toBe(15);
      expect(singleById.fields[formulaField.id]).toBe(30);

      // Single PATCH
      const patchSingleRes = await app.request(`/api/table/${tableId}/record/${rec1Id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          record: { fields: { Price: 20 } },
        }),
      });
      expect(patchSingleRes.status).toBe(200);
      expect(await patchSingleRes.json()).toMatchObject({
        id: rec1Id,
        fields: { Code: 'ORD-1', Price: 20, DoublePrice: 40 },
      });

      // Batch PATCH returns IRecord[] array with recomputed formula
      const patchBatchRes = await app.request(`/api/table/${tableId}/record`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          fieldKeyType: 'id',
          records: [
            { id: rec1Id, fields: { [priceField.id]: 12 } },
            { id: rec2Id, fields: { [priceField.id]: 30 } },
          ],
        }),
      });
      expect(patchBatchRes.status).toBe(200);
      const batchPatched = (await patchBatchRes.json()) as Array<{
        id: string;
        fields: Record<string, unknown>;
      }>;
      expect(batchPatched).toHaveLength(2);
      expect(batchPatched[0]?.fields[formulaField.id]).toBe(24);
      expect(batchPatched[1]?.fields[formulaField.id]).toBe(60);

      // Upsert create + update
      const upsertRes = await app.request(`/api/table/${tableId}/record/upsert`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          matchField: codeField.id,
          onConflict: 'update',
          records: [
            { fields: { Code: 'ORD-1', Price: 50 } },
            { fields: { Code: 'ORD-3', Price: 7 } },
          ],
        }),
      });
      expect(upsertRes.status).toBe(200);
      const upsertBody = (await upsertRes.json()) as {
        summary: { created: number; updated: number };
        results: Array<{ status: string; record?: { fields: Record<string, unknown> } }>;
      };
      expect(upsertBody.summary.updated).toBe(1);
      expect(upsertBody.summary.created).toBe(1);
      expect(upsertBody.results[0]?.record?.fields.DoublePrice).toBe(100);
      expect(upsertBody.results[1]?.record?.fields.DoublePrice).toBe(14);

      // 5. /api/v2/* proxy routes + automatic computed flush
      const v2UpdateRes = await app.request('/api/v2/tables/updateRecords', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tableId,
          filter: { fieldId: codeField.id, operator: 'is', value: 'ORD-2' },
          fields: { [priceField.id]: 45 },
          fieldKeyType: 'id',
        }),
      });
      expect(v2UpdateRes.status).toBe(200);
      const v2UpdateBody = (await v2UpdateRes.json()) as {
        ok: boolean;
        data?: { updatedCount: number };
      };
      expect(v2UpdateBody.ok).toBe(true);
      expect(v2UpdateBody.data?.updatedCount).toBe(1);

      // Verify formula recomputation from /api/v2/tables/updateRecords shows up immediately in /vcs/snapshot
      const snapshotRes = await app.request(`/vcs/snapshot?baseId=${BASE_ID}`, { headers });
      expect(snapshotRes.status).toBe(200);
      const snapshotBody = (await snapshotRes.json()) as {
        ok: boolean;
        data: IBaseVcsSnapshot;
      };
      const snapshotRec2 = snapshotBody.data.tables[0]?.records.find((r) => r.id === rec2Id);
      expect(snapshotRec2?.fields[formulaField.id]).toBe(90);

      // Conditional delete via /api/v2/tables/deleteRecords
      const v2DeleteRes = await app.request('/api/v2/tables/deleteRecords', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({
          tableId,
          filter: { fieldId: codeField.id, operator: 'is', value: 'ORD-3' },
        }),
      });
      expect(v2DeleteRes.status).toBe(200);
      const v2DeleteBody = (await v2DeleteRes.json()) as {
        ok: boolean;
        data?: { deletedCount: number };
      };
      expect(v2DeleteBody.ok).toBe(true);
      expect(v2DeleteBody.data?.deletedCount).toBe(1);

      // Batch query delete on OpenAPI v1
      const deleteRecRes = await app.request(`/api/table/${tableId}/record?recordIds[]=${rec2Id}`, {
        method: 'DELETE',
        headers,
      });
      expect(deleteRecRes.status).toBe(200);

      // 6. View CRUD
      const createViewRes = await app.request(`/api/table/${tableId}/view`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'High Price', type: 'grid' }),
      });
      expect(createViewRes.status).toBe(201);
      const createdView = (await createViewRes.json()) as { id: string; name: string };
      const viewId = createdView.id;

      expect(
        (
          await app.request(`/api/table/${tableId}/view/${viewId}/name`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ name: 'Filtered Grid' }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await app.request(`/api/table/${tableId}/view/${viewId}/description`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ description: 'View desc' }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await app.request(`/api/table/${tableId}/view/${viewId}/filter`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: priceField.id, operator: 'isGreater', value: 10 }],
              },
            }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await app.request(`/api/table/${tableId}/view/${viewId}/sort`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              sort: { sortObjs: [{ fieldId: priceField.id, order: 'desc' }] },
            }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await app.request(`/api/table/${tableId}/view/${viewId}/group`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ group: [{ fieldId: codeField.id, order: 'asc' }] }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await app.request(`/api/table/${tableId}/view/${viewId}/column-meta`, {
            method: 'PUT',
            headers,
            body: JSON.stringify([{ fieldId: priceField.id, columnMeta: { width: 220 } }]),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await app.request(`/api/table/${tableId}/view/${viewId}/options`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ options: { rowHeight: 'tall' } }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await app.request(`/api/table/${tableId}/view/${viewId}/locked`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ isLocked: true }),
          })
        ).status
      ).toBe(200);

      const getViewRes = await app.request(`/api/table/${tableId}/view/${viewId}`, { headers });
      expect(getViewRes.status).toBe(200);
      expect(await getViewRes.json()).toMatchObject({
        id: viewId,
        name: 'Filtered Grid',
        description: 'View desc',
        isLocked: true,
      });

      const listViewsRes = await app.request(`/api/table/${tableId}/view`, { headers });
      expect(listViewsRes.status).toBe(200);
      expect((await listViewsRes.json()) as unknown[]).toHaveLength(2);

      expect(
        (
          await app.request(`/api/table/${tableId}/view/${viewId}`, {
            method: 'DELETE',
            headers,
          })
        ).status
      ).toBe(200);

      // 7. OpenAPI domain error format check & table deletion
      const missingRecordRes = await app.request(`/api/table/${tableId}/record/rec00000000000000`, {
        headers,
      });
      expect(missingRecordRes.status).toBe(404);
      const missingErr = (await missingRecordRes.json()) as {
        message: string;
        code: string;
        status: number;
        data?: { domainCode?: string };
      };
      expect(missingErr.status).toBe(404);
      expect(missingErr.message).toBeTruthy();
      expect(missingErr.data?.domainCode).toBe(missingErr.code);

      expect(
        (
          await app.request(`/api/base/${BASE_ID}/table/${tableId}/permanent`, {
            method: 'DELETE',
            headers,
          })
        ).status
      ).toBe(200);
    } finally {
      await runtime.close();
    }
  }, 60_000);
});
