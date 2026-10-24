import type { V2HttpClient } from '@teable/v2-contract-http-client';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('[F01] create-field: view visibility across views (e2e)', () => {
  let ctx: SharedTestContext;
  let client: V2HttpClient;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    client = createV2HttpClient({ baseUrl: ctx.baseUrl });
  });

  const createFixture = async (name: string) => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name,
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'Notes' },
      ],
      views: [
        { type: 'grid', name: 'Untouched' },
        { type: 'grid', name: 'Editing' },
      ],
    });
    const untouchedView = table.views.find((view) => view.name === 'Untouched');
    const editingView = table.views.find((view) => view.name === 'Editing');
    const notesField = table.fields.find((field) => field.name === 'Notes');
    if (!untouchedView || !editingView || !notesField) {
      throw new Error('View visibility fixture is incomplete');
    }
    return { table, untouchedView, editingView, notesField };
  };

  const setHidden = async (tableId: string, viewId: string, fieldId: string, hidden: boolean) => {
    const result = await client.tables.updateViewColumnMeta({
      tableId,
      viewId,
      columnMeta: [{ fieldId, columnMeta: { hidden } }],
    });
    expect(result.ok).toBe(true);
  };

  it('shows a new field in a grid view that hides no field', async () => {
    const { table, untouchedView, editingView, notesField } = await createFixture(
      'new-field-visible-in-unhidden-view'
    );

    try {
      // The "hide this column, then show all" round trip leaves an explicit
      // `hidden: false` entry behind while the view hides nothing.
      await setHidden(table.id, untouchedView.id, notesField.id, true);
      await setHidden(table.id, untouchedView.id, notesField.id, false);

      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        viewId: editingView.id,
        field: { type: 'singleLineText', name: 'Added' },
      });
      const addedField = created.fields.find((field) => field.name === 'Added');
      if (!addedField) throw new Error('Missing created field');

      const view = await client.tables.getView({ tableId: table.id, viewId: untouchedView.id });
      expect(view.ok).toBe(true);
      if (!view.ok) return;

      expect(view.data.view.columnMeta[addedField.id]?.hidden).not.toBe(true);
      expect(view.data.view.columnMeta[notesField.id]?.hidden).toBe(false);

      const creatingView = await client.tables.getView({
        tableId: table.id,
        viewId: editingView.id,
      });
      expect(creatingView.ok).toBe(true);
      if (creatingView.ok) {
        expect(creatingView.data.view.columnMeta[addedField.id]?.hidden).toBeUndefined();
      }
    } finally {
      await ctx.deleteTable(table.id, { mode: 'permanent' }).catch(() => undefined);
    }
  });

  it('hides a new field in a grid view that hides at least one field', async () => {
    const { table, untouchedView, editingView, notesField } = await createFixture(
      'new-field-hidden-in-hidden-view'
    );

    try {
      await setHidden(table.id, untouchedView.id, notesField.id, true);

      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        viewId: editingView.id,
        field: { type: 'singleLineText', name: 'Added' },
      });
      const addedField = created.fields.find((field) => field.name === 'Added');
      if (!addedField) throw new Error('Missing created field');

      const view = await client.tables.getView({ tableId: table.id, viewId: untouchedView.id });
      expect(view.ok).toBe(true);
      if (!view.ok) return;

      expect(view.data.view.columnMeta[addedField.id]?.hidden).toBe(true);
      expect(view.data.view.columnMeta[notesField.id]?.hidden).toBe(true);
    } finally {
      await ctx.deleteTable(table.id, { mode: 'permanent' }).catch(() => undefined);
    }
  });
});
