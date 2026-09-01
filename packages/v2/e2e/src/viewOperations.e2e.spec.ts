import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from './shared/globalTestContext';

describe('v2 http View operation contracts (e2e)', () => {
  let ctx: SharedTestContext;
  let client: ReturnType<typeof createV2HttpClient>;
  let tableId: string;
  let foreignTableId: string;
  let viewId: string;
  let seedViewId: string;
  let foreignViewId: string;
  let primaryFieldId: string;
  let statusFieldId: string;
  let pluginViewId: string | undefined;
  let pluginInstallId: string | undefined;

  const pluginId = `plg${'c'.repeat(16)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'View Operations Contract',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { id: 'choTodo', name: 'Todo', color: 'blue' },
              { id: 'choDone', name: 'Done', color: 'green' },
            ],
          },
        },
      ],
      views: [
        { type: 'grid', name: 'Seed' },
        { type: 'grid', name: 'Working' },
      ],
    });
    tableId = table.id;
    seedViewId = table.views[0]?.id ?? '';
    viewId = table.views[1]?.id ?? '';
    primaryFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
    if (!seedViewId || !viewId || !primaryFieldId || !statusFieldId) {
      throw new Error('View operation contract fixture is incomplete');
    }

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Foreign View Operations Contract',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid', name: 'Foreign' }],
    });
    foreignTableId = foreignTable.id;
    foreignViewId = foreignTable.views[0]?.id ?? '';
    if (!foreignViewId) throw new Error('Foreign View fixture is incomplete');

    await ctx.testContainer.db.schema
      .createTable('plugin')
      .ifNotExists()
      .addColumn('id', 'varchar', (column) => column.primaryKey())
      .addColumn('name', 'varchar', (column) => column.notNull())
      .addColumn('logo', 'varchar', (column) => column.notNull())
      .addColumn('url', 'varchar')
      .addColumn('status', 'varchar', (column) => column.notNull())
      .addColumn('positions', 'text', (column) => column.notNull())
      .addColumn('created_by', 'varchar', (column) => column.notNull())
      .execute();
    await ctx.testContainer.db.schema
      .createTable('plugin_install')
      .ifNotExists()
      .addColumn('id', 'varchar', (column) => column.primaryKey())
      .addColumn('plugin_id', 'varchar', (column) => column.notNull())
      .addColumn('base_id', 'varchar', (column) => column.notNull())
      .addColumn('name', 'varchar', (column) => column.notNull())
      .addColumn('position_id', 'varchar', (column) => column.notNull())
      .addColumn('position', 'varchar', (column) => column.notNull())
      .addColumn('storage', 'text')
      .addColumn('created_time', 'timestamptz', (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('created_by', 'varchar', (column) => column.notNull())
      .addColumn('last_modified_time', 'timestamptz')
      .addColumn('last_modified_by', 'varchar')
      .execute();

    await ctx.testContainer.db
      .insertInto('plugin')
      .values({
        id: pluginId,
        name: 'Contract Plugin',
        logo: 'contract-plugin.svg',
        url: 'https://example.test/plugin',
        status: 'published',
        positions: JSON.stringify(['view']),
        created_by: TEST_USER.id,
      })
      .execute();
  });

  afterAll(async () => {
    if (ctx && tableId)
      await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
    if (ctx && foreignTableId) {
      await ctx.deleteTable(foreignTableId, { mode: 'permanent' }).catch(() => undefined);
    }
    if (ctx) {
      await ctx.testContainer.db
        .deleteFrom('plugin_install')
        .where('plugin_id', '=', pluginId)
        .execute()
        .catch(() => undefined);
      await ctx.testContainer.db
        .deleteFrom('plugin')
        .where('id', '=', pluginId)
        .execute()
        .catch(() => undefined);
    }
  });

  it('exposes filter-link records, snapshots, and document IDs through aggregate reads', async () => {
    const links = await client.tables.getViewFilterLinkRecords({ tableId, viewId });
    expect(links).toEqual({ ok: true, data: { groups: [] } });

    const snapshots = await client.tables.getViewSnapshots({
      tableId,
      viewIds: [viewId, seedViewId],
    });
    expect(snapshots.ok).toBe(true);
    if (!snapshots.ok) return;
    expect(snapshots.data.snapshots.map((snapshot) => snapshot.id)).toEqual([viewId, seedViewId]);
    expect(snapshots.data.snapshots[0]).toMatchObject({
      id: viewId,
      type: 'json0',
      data: { id: viewId, name: 'Working' },
    });

    const docIds = await client.tables.listViewDocIds({ tableId });
    expect(docIds).toEqual({
      ok: true,
      data: { ids: [seedViewId, viewId] },
    });
  });

  it('runs every ordinary View lifecycle mutation through Table aggregate commands', async () => {
    const renamed = await client.tables.renameView({
      tableId,
      viewId,
      name: 'Planning',
    });
    expect(renamed.ok).toBe(true);

    const described = await client.tables.updateViewDescription({
      tableId,
      viewId,
      description: 'Planning details',
    });
    expect(described.ok).toBe(true);

    const locked = await client.tables.updateViewLocked({
      tableId,
      viewId,
      isLocked: true,
    });
    expect(locked.ok).toBe(true);

    const ordered = await client.tables.updateViewOrder({
      tableId,
      viewId,
      anchorId: seedViewId,
      position: 'before',
    });
    expect(ordered.ok).toBe(true);

    const columnMeta = await client.tables.updateViewColumnMeta({
      tableId,
      viewId,
      columnMeta: [{ fieldId: primaryFieldId, columnMeta: { width: 280 } }],
    });
    expect(columnMeta.ok).toBe(true);

    const filtered = await client.tables.updateViewFilter({
      tableId,
      viewId,
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: primaryFieldId,
            operator: 'LIKE',
            isSymbol: true,
            value: 'alpha',
          },
        ],
      },
    });
    expect(filtered.ok).toBe(true);

    const sorted = await client.tables.updateViewSort({
      tableId,
      viewId,
      sort: {
        sortObjs: [{ fieldId: primaryFieldId, order: 'asc' }],
        manualSort: false,
      },
    });
    expect(sorted.ok).toBe(true);

    const grouped = await client.tables.updateViewGroup({
      tableId,
      viewId,
      group: [{ fieldId: statusFieldId, order: 'desc' }],
    });
    expect(grouped.ok).toBe(true);

    const options = await client.tables.updateViewOptions({
      tableId,
      viewId,
      options: { rowHeight: 'medium' },
    });
    expect(options.ok).toBe(true);

    const manualSort = await client.tables.applyViewManualSort({
      tableId,
      viewId,
      sort: [],
    });
    expect(manualSort).toMatchObject({
      ok: true,
      data: { viewId, updatedRecordCount: 0 },
    });

    const current = await client.tables.getView({ tableId, viewId });
    expect(current).toMatchObject({
      ok: true,
      data: {
        view: {
          id: viewId,
          name: 'Planning',
          description: 'Planning details',
          isLocked: true,
          options: { rowHeight: 'medium' },
          columnMeta: { [primaryFieldId]: { width: 280 } },
        },
      },
    });
  });

  it('keeps share credentials replay-safe and out of non-credential responses', async () => {
    const enabled = await client.tables.enableViewShare({ tableId, viewId });
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;
    expect(enabled.data.shareId).toMatch(/^shr/);
    const firstShareId = enabled.data.shareId;

    const metadata = await client.tables.updateViewShareMeta({
      tableId,
      viewId,
      shareMeta: { allowCopy: false, password: 'secret' },
    });
    expect(metadata).toEqual({ ok: true, data: { viewId } });
    expect(JSON.stringify(metadata)).not.toContain('secret');
    expect(JSON.stringify(metadata)).not.toContain(firstShareId);

    const refreshed = await client.tables.refreshViewShareId({ tableId, viewId });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.data.shareId).toMatch(/^shr/);
    expect(refreshed.data.shareId).not.toBe(firstShareId);
    expect(JSON.stringify(refreshed)).not.toContain(firstShareId);

    const disabled = await client.tables.disableViewShare({ tableId, viewId });
    expect(disabled).toEqual({ ok: true, data: { viewId } });
    expect(JSON.stringify(disabled)).not.toContain(refreshed.data.shareId);
  });

  it('duplicates and deletes View children without bypassing the aggregate', async () => {
    const duplicated = await client.tables.duplicateView({ tableId, viewId });
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    const duplicateViewId = duplicated.data.viewId;
    expect(duplicateViewId).not.toBe(viewId);
    expect(duplicated.data.table.views).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: duplicateViewId, name: 'Planning 2' })])
    );

    const deleted = await client.tables.deleteView({
      tableId,
      viewId: duplicateViewId,
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.data.table.views.some((view) => view.id === duplicateViewId)).toBe(false);
  });

  it('installs, reads, and updates a Plugin View through native contracts', async () => {
    const installed = await client.tables.installViewPlugin({
      tableId,
      pluginId,
      name: 'Contract Plugin View',
    });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    pluginViewId = installed.data.viewId;
    pluginInstallId = installed.data.pluginInstallId;
    expect(installed.data).toMatchObject({
      pluginId,
      name: 'Contract Plugin View',
    });

    const metadata = await client.tables.getViewPluginInstall({
      tableId,
      viewId: pluginViewId,
    });
    expect(metadata).toMatchObject({
      ok: true,
      data: {
        pluginId,
        pluginInstallId,
        baseId: ctx.baseId,
        name: 'Contract Plugin View',
        url: 'https://example.test/plugin',
      },
    });

    const updated = await client.tables.updateViewPluginStorage({
      tableId,
      viewId: pluginViewId,
      pluginInstallId,
      storage: { nested: { enabled: true }, count: 2 },
    });
    expect(updated).toEqual({
      ok: true,
      data: {
        tableId,
        viewId: pluginViewId,
        pluginInstallId,
        storage: { nested: { enabled: true }, count: 2 },
      },
    });

    const reread = await client.tables.getViewPluginInstall({
      tableId,
      viewId: pluginViewId,
    });
    expect(reread).toMatchObject({
      ok: true,
      data: { storage: { nested: { enabled: true }, count: 2 } },
    });
  });

  it('rejects malformed and cross-Table child identifiers at the interface boundary', async () => {
    const malformed = await fetch(`${ctx.baseUrl}/tables/renameView`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: 'invalid', viewId: 'invalid', name: 'Nope' }),
    });
    expect(malformed.status).toBe(400);

    await expect(
      client.tables.renameView({
        tableId,
        viewId: foreignViewId,
        name: 'Cross aggregate',
      })
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      client.tables.getViewSnapshots({
        tableId,
        viewIds: [foreignViewId],
      })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('v2 http View v1-parity coverage (e2e)', () => {
  let ctx: SharedTestContext;
  let client: ReturnType<typeof createV2HttpClient>;
  let tableId: string;
  let nameFieldId: string;
  let statusFieldId: string;
  let notesFieldId: string;
  let formViewId: string;
  let recordIds: string[];

  const getViewOrThrow = async (targetTableId: string, viewId: string) => {
    const result = await client.tables.getView({ tableId: targetTableId, viewId });
    if (!result.ok) throw new Error(result.error.message);
    return result.data.view;
  };

  const createGridView = async (name: string) => {
    const created = await client.tables.createView({
      tableId,
      view: { type: 'grid', name },
    });
    if (!created.ok) throw new Error(created.error.message);
    return created.data.viewId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'View V1 Parity',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { id: 'choTodo', name: 'Todo', color: 'blue' },
              { id: 'choDone', name: 'Done', color: 'green' },
            ],
          },
        },
        { type: 'singleLineText', name: 'Notes' },
      ],
      views: [
        { type: 'grid', name: 'Parity Grid' },
        { type: 'form', name: 'Parity Form' },
      ],
    });
    tableId = table.id;
    nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
    notesFieldId = table.fields.find((field) => field.name === 'Notes')?.id ?? '';
    formViewId = table.views.find((view) => view.type === 'form')?.id ?? '';
    if (!nameFieldId || !statusFieldId || !notesFieldId || !formViewId) {
      throw new Error('View parity fixture is incomplete');
    }

    const created = await ctx.createRecords(tableId, [
      { fields: { [nameFieldId]: 'Beta' } },
      { fields: { [nameFieldId]: 'Alpha' } },
      { fields: { [nameFieldId]: 'Beta' } },
    ]);
    recordIds = created.map((record) => record.id);
  });

  afterAll(async () => {
    if (ctx && tableId)
      await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
  });

  it('round-trips filter, sort, and group through set and null clear', async () => {
    const viewId = await createGridView('Query defaults roundtrip');

    const filter = {
      conjunction: 'and' as const,
      filterSet: [{ fieldId: nameFieldId, operator: 'is' as const, value: 'Alpha' }],
    };
    const filtered = await client.tables.updateViewFilter({ tableId, viewId, filter });
    expect(filtered.ok).toBe(true);
    const sorted = await client.tables.updateViewSort({
      tableId,
      viewId,
      sort: { sortObjs: [{ fieldId: nameFieldId, order: 'asc' }], manualSort: false },
    });
    expect(sorted.ok).toBe(true);
    const grouped = await client.tables.updateViewGroup({
      tableId,
      viewId,
      group: [{ fieldId: statusFieldId, order: 'desc' }],
    });
    expect(grouped.ok).toBe(true);

    const populated = await getViewOrThrow(tableId, viewId);
    expect(populated.filter).toEqual(filter);
    expect(populated.sort).toEqual({
      sortObjs: [{ fieldId: nameFieldId, order: 'asc' }],
      manualSort: false,
    });
    expect(populated.group).toEqual([{ fieldId: statusFieldId, order: 'desc' }]);

    const filterCleared = await client.tables.updateViewFilter({ tableId, viewId, filter: null });
    expect(filterCleared.ok).toBe(true);
    const sortCleared = await client.tables.updateViewSort({ tableId, viewId, sort: null });
    expect(sortCleared.ok).toBe(true);
    const groupCleared = await client.tables.updateViewGroup({ tableId, viewId, group: null });
    expect(groupCleared.ok).toBe(true);

    const cleared = await getViewOrThrow(tableId, viewId);
    expect(cleared.filter ?? null).toBeNull();
    expect(cleared.sort ?? null).toBeNull();
    expect(cleared.group ?? null).toBeNull();
  });

  it('merges order, hidden, width, and statisticFunc column meta without covering prior patches', async () => {
    const viewId = await createGridView('Column meta merge');

    // v1 set-column-meta: sequential single-property patches must merge.
    const orderPatch = await client.tables.updateViewColumnMeta({
      tableId,
      viewId,
      columnMeta: [{ fieldId: statusFieldId, columnMeta: { order: 10 } }],
    });
    expect(orderPatch.ok).toBe(true);
    const hiddenPatch = await client.tables.updateViewColumnMeta({
      tableId,
      viewId,
      columnMeta: [{ fieldId: statusFieldId, columnMeta: { hidden: true } }],
    });
    expect(hiddenPatch.ok).toBe(true);
    const widthPatch = await client.tables.updateViewColumnMeta({
      tableId,
      viewId,
      columnMeta: [{ fieldId: statusFieldId, columnMeta: { width: 200 } }],
    });
    expect(widthPatch.ok).toBe(true);

    // v1 set-column-meta: one multi-property patch lands atomically.
    const multiPatch = await client.tables.updateViewColumnMeta({
      tableId,
      viewId,
      columnMeta: [
        {
          fieldId: notesFieldId,
          columnMeta: { width: 200, statisticFunc: 'empty', hidden: true, order: 100 },
        },
      ],
    });
    expect(multiPatch.ok).toBe(true);

    const view = await getViewOrThrow(tableId, viewId);
    expect(view.columnMeta[statusFieldId]).toMatchObject({
      order: 10,
      hidden: true,
      width: 200,
    });
    expect(view.columnMeta[notesFieldId]).toMatchObject({
      width: 200,
      statisticFunc: 'empty',
      hidden: true,
      order: 100,
    });
  });

  it('rejects hiding the primary field, unknown fields, and malformed field ids', async () => {
    const viewId = await createGridView('Column meta guards');

    await expect(
      client.tables.updateViewColumnMeta({
        tableId,
        viewId,
        columnMeta: [{ fieldId: nameFieldId, columnMeta: { hidden: true } }],
      })
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      client.tables.updateViewColumnMeta({
        tableId,
        viewId,
        columnMeta: [{ fieldId: `fld${'z'.repeat(16)}`, columnMeta: { width: 200 } }],
      })
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      client.tables.updateViewColumnMeta({
        tableId,
        viewId,
        columnMeta: [{ fieldId: 'fakeFieldID', columnMeta: { width: 200 } }],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('updates required and visible column meta on a form view', async () => {
    const patched = await client.tables.updateViewColumnMeta({
      tableId,
      viewId: formViewId,
      columnMeta: [{ fieldId: statusFieldId, columnMeta: { required: true, visible: true } }],
    });
    expect(patched.ok).toBe(true);

    const view = await getViewOrThrow(tableId, formViewId);
    expect(view.columnMeta[statusFieldId]).toMatchObject({ required: true, visible: true });
  });

  it('shifts the frozen boundary to the previous neighbor when the frozen column moves', async () => {
    const viewId = await createGridView('Frozen boundary shift');

    const frozen = await client.tables.updateViewOptions({
      tableId,
      viewId,
      options: { frozenFieldId: statusFieldId },
    });
    expect(frozen.ok).toBe(true);
    const before = await getViewOrThrow(tableId, viewId);
    expect((before.options as { frozenFieldId?: string }).frozenFieldId).toBe(statusFieldId);

    // Move the frozen column (index 1 of [Name, Status, Notes]) to the end.
    const moved = await client.tables.updateViewColumnMeta({
      tableId,
      viewId,
      columnMeta: [{ fieldId: statusFieldId, columnMeta: { order: 9999 } }],
    });
    expect(moved.ok).toBe(true);

    const after = await getViewOrThrow(tableId, viewId);
    expect((after.options as { frozenFieldId?: string }).frozenFieldId).toBe(nameFieldId);
  });

  it('rejects options belonging to another view subtype without persistence', async () => {
    await expect(
      client.tables.updateViewOptions({
        tableId,
        viewId: formViewId,
        options: { rowHeight: 'short' },
      })
    ).rejects.toMatchObject({ status: 400 });

    const submit = await client.tables.updateViewOptions({
      tableId,
      viewId: formViewId,
      options: { submitLabel: 'Confirm' },
    });
    expect(submit.ok).toBe(true);
    const view = await getViewOrThrow(tableId, formViewId);
    expect((view.options as { submitLabel?: string }).submitLabel).toBe('Confirm');
    expect((view.options as { rowHeight?: string }).rowHeight).toBeUndefined();
  });

  // v1 parity (view-option.e2e-spec, T6520): deleting the field carrying the
  // frozen boundary moves options.frozenFieldId to the previous visible column.
  it('shifts the frozen boundary when the frozen field itself is deleted', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Frozen Delete Parity',
      fields: [
        { type: 'singleLineText', name: 'First', isPrimary: true },
        { type: 'singleLineText', name: 'Middle' },
        { type: 'singleLineText', name: 'Last' },
      ],
      views: [{ type: 'grid', name: 'Frozen' }],
    });
    try {
      const viewId = table.views[0]?.id ?? '';
      const firstFieldId = table.fields.find((field) => field.name === 'First')?.id ?? '';
      const middleFieldId = table.fields.find((field) => field.name === 'Middle')?.id ?? '';
      const frozen = await client.tables.updateViewOptions({
        tableId: table.id,
        viewId,
        options: { frozenFieldId: middleFieldId },
      });
      expect(frozen.ok).toBe(true);

      await ctx.deleteField({ tableId: table.id, fieldId: middleFieldId });

      const result = await client.tables.getView({ tableId: table.id, viewId });
      if (!result.ok) throw new Error(result.error.message);
      expect((result.data.view.options as { frozenFieldId?: string }).frozenFieldId).toBe(
        firstFieldId
      );
    } finally {
      await ctx.deleteTable(table.id, { mode: 'permanent' }).catch(() => undefined);
    }
  });

  it('clears the frozen boundary when the first frozen column is deleted', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Frozen Delete First Column',
      fields: [
        { type: 'singleLineText', name: 'First', isPrimary: true },
        { type: 'singleLineText', name: 'Second' },
      ],
      views: [{ type: 'grid', name: 'Frozen' }],
    });
    try {
      const viewId = table.views[0]?.id ?? '';
      const secondFieldId = table.fields.find((field) => field.name === 'Second')?.id ?? '';
      // Move the field to the front first, then freeze it: deleting it leaves
      // no previous column, so the boundary must clear entirely.
      const reorder = await client.tables.updateViewColumnMeta({
        tableId: table.id,
        viewId,
        columnMeta: [{ fieldId: secondFieldId, columnMeta: { order: -1 } }],
      });
      expect(reorder.ok).toBe(true);
      const frozen = await client.tables.updateViewOptions({
        tableId: table.id,
        viewId,
        options: { frozenFieldId: secondFieldId },
      });
      expect(frozen.ok).toBe(true);

      await ctx.deleteField({ tableId: table.id, fieldId: secondFieldId });

      const result = await client.tables.getView({ tableId: table.id, viewId });
      if (!result.ok) throw new Error(result.error.message);
      expect(
        (result.data.view.options as { frozenFieldId?: string }).frozenFieldId
      ).toBeUndefined();
    } finally {
      await ctx.deleteTable(table.id, { mode: 'permanent' }).catch(() => undefined);
    }
  });

  it('materializes multi-row manual sort with stable ties and flags manualSort', async () => {
    const viewId = await createGridView('Manual sort parity');

    const applied = await client.tables.applyViewManualSort({
      tableId,
      viewId,
      sort: [{ fieldId: nameFieldId, order: 'desc' }],
    });
    expect(applied).toMatchObject({
      ok: true,
      data: { viewId },
    });

    const view = await getViewOrThrow(tableId, viewId);
    expect(view.sort).toEqual({
      sortObjs: [{ fieldId: nameFieldId, order: 'desc' }],
      manualSort: true,
    });

    const ordered = await ctx.listRecords(tableId, { viewId });
    expect(ordered.map((record) => record.id)).toEqual([recordIds[0], recordIds[2], recordIds[1]]);
  });

  it('rejects manual sort on a non-Grid view', async () => {
    const gallery = await client.tables.createView({
      tableId,
      view: { type: 'gallery', name: 'Manual sort gallery' },
    });
    if (!gallery.ok) throw new Error(gallery.error.message);

    await expect(
      client.tables.applyViewManualSort({
        tableId,
        viewId: gallery.data.viewId,
        sort: [],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('guards the share lifecycle against disabled refresh and repeated transitions', async () => {
    const viewId = await createGridView('Share lifecycle guards');

    await expect(client.tables.refreshViewShareId({ tableId, viewId })).rejects.toMatchObject({
      status: 400,
    });

    const enabled = await client.tables.enableViewShare({ tableId, viewId });
    expect(enabled.ok).toBe(true);
    await expect(client.tables.enableViewShare({ tableId, viewId })).rejects.toMatchObject({
      status: 400,
    });

    const disabled = await client.tables.disableViewShare({ tableId, viewId });
    expect(disabled.ok).toBe(true);
    await expect(client.tables.disableViewShare({ tableId, viewId })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('toggles the locked flag on and off through the aggregate', async () => {
    const viewId = await createGridView('Locked toggle');

    const locked = await client.tables.updateViewLocked({ tableId, viewId, isLocked: true });
    expect(locked.ok).toBe(true);
    expect((await getViewOrThrow(tableId, viewId)).isLocked).toBe(true);

    const unlocked = await client.tables.updateViewLocked({ tableId, viewId, isLocked: false });
    expect(unlocked.ok).toBe(true);
    expect((await getViewOrThrow(tableId, viewId)).isLocked ?? false).toBe(false);
  });
});

describe('v2 http View filter-link-records v1 parity (e2e)', () => {
  let ctx: SharedTestContext;
  let client: ReturnType<typeof createV2HttpClient>;
  let hostTableId: string;
  let linkTable1Id: string;
  let linkTable2Id: string;
  let plainFieldId: string;
  let linkField1Id: string;
  let linkField2Id: string;
  let linkTable1RecordIds: string[];
  let linkTable2RecordIds: string[];
  let linkTable1ViewId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const makeLinkTable = async (name: string, prefix: string) => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name,
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid', name: 'Grid' }],
      });
      const titleFieldId = table.fields[0]?.id ?? '';
      const created = await ctx.createRecords(table.id, [
        { fields: { [titleFieldId]: `${prefix}_record1` } },
        { fields: { [titleFieldId]: `${prefix}_record2` } },
        { fields: { [titleFieldId]: `${prefix}_record3` } },
      ]);
      return {
        id: table.id,
        titleFieldId,
        viewId: table.views[0]?.id ?? '',
        recordIds: created.map((record) => record.id),
      };
    };

    const linkTable1 = await makeLinkTable('Filter Link Table 1', 'link_table1');
    const linkTable2 = await makeLinkTable('Filter Link Table 2', 'link_table2');
    linkTable1Id = linkTable1.id;
    linkTable2Id = linkTable2.id;
    linkTable1RecordIds = linkTable1.recordIds;
    linkTable2RecordIds = linkTable2.recordIds;
    linkTable1ViewId = linkTable1.viewId;

    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Filter Link Host',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'link',
          name: 'Link One',
          options: {
            relationship: 'manyOne',
            foreignTableId: linkTable1.id,
            lookupFieldId: linkTable1.titleFieldId,
            isOneWay: true,
          },
        },
        {
          type: 'link',
          name: 'Link Two',
          options: {
            relationship: 'manyOne',
            foreignTableId: linkTable2.id,
            lookupFieldId: linkTable2.titleFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid', name: 'Host Grid' }],
    });
    hostTableId = host.id;
    plainFieldId = host.fields.find((field) => field.isPrimary)?.id ?? '';
    linkField1Id = host.fields.find((field) => field.name === 'Link One')?.id ?? '';
    linkField2Id = host.fields.find((field) => field.name === 'Link Two')?.id ?? '';
    if (!plainFieldId || !linkField1Id || !linkField2Id) {
      throw new Error('Filter link fixture is incomplete');
    }
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const id of [hostTableId, linkTable1Id, linkTable2Id]) {
      if (id) await ctx.deleteTable(id, { mode: 'permanent' }).catch(() => undefined);
    }
  });

  it('returns nested, deduplicated link records without the missing record id', async () => {
    const missingRecordId = `rec${'z'.repeat(16)}`;
    const created = await client.tables.createView({
      tableId: hostTableId,
      view: {
        type: 'grid',
        name: 'Link filter view',
        sourceFilter: {
          conjunction: 'and',
          filterSet: [
            { fieldId: linkField1Id, operator: 'is', value: linkTable1RecordIds[0] },
            {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: linkField1Id,
                  operator: 'isAnyOf',
                  value: [...linkTable1RecordIds, missingRecordId],
                },
              ],
            },
            { fieldId: linkField2Id, operator: 'is', value: linkTable2RecordIds[0] },
            {
              conjunction: 'and',
              filterSet: [
                { fieldId: linkField2Id, operator: 'isAnyOf', value: [linkTable2RecordIds[2]] },
              ],
            },
          ],
        },
      },
    });
    if (!created.ok) throw new Error(created.error.message);

    const links = await client.tables.getViewFilterLinkRecords({
      tableId: hostTableId,
      viewId: created.data.viewId,
    });
    expect(links.ok).toBe(true);
    if (!links.ok) return;
    expect(links.data.groups).toEqual([
      {
        tableId: linkTable1Id,
        records: [
          { id: linkTable1RecordIds[0], title: 'link_table1_record1' },
          { id: linkTable1RecordIds[1], title: 'link_table1_record2' },
          { id: linkTable1RecordIds[2], title: 'link_table1_record3' },
        ],
      },
      {
        tableId: linkTable2Id,
        records: [
          { id: linkTable2RecordIds[0], title: 'link_table2_record1' },
          { id: linkTable2RecordIds[2], title: 'link_table2_record3' },
        ],
      },
    ]);
  });

  it('returns no groups when the filter does not reference a Link field', async () => {
    const created = await client.tables.createView({
      tableId: hostTableId,
      view: {
        type: 'grid',
        name: 'No link references',
        sourceFilter: {
          conjunction: 'and',
          filterSet: [{ fieldId: plainFieldId, operator: 'is', value: 'anything' }],
        },
      },
    });
    if (!created.ok) throw new Error(created.error.message);

    const links = await client.tables.getViewFilterLinkRecords({
      tableId: hostTableId,
      viewId: created.data.viewId,
    });
    expect(links).toEqual({ ok: true, data: { groups: [] } });
  });

  it('rejects a View owned by another Table with view.not_found', async () => {
    await expect(
      client.tables.getViewFilterLinkRecords({
        tableId: hostTableId,
        viewId: linkTable1ViewId,
      })
    ).rejects.toMatchObject({ status: 404 });
  });
});
