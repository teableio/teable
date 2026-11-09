import { createV2HttpClient } from '@teable/v2-contract-http-client';
import {
  DeleteFieldsCommand,
  UpdateFieldCommand,
  ViewColumnMeta,
  type ViewColumnMetaValue,
} from '@teable/v2-core';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';
import {
  buildUndoRedoContext,
  executeUndo,
  getCommandBus,
} from '../../undo-redo/shared/undoRedoE2eTestKit';

interface TargetFixture {
  tableId: string;
  primaryFieldId: string;
  initialMeta: Map<string, ViewColumnMetaValue>;
  customizedGridId: string;
  customizedGalleryId: string;
}

describe('reciprocal link field view metadata persistence', () => {
  let ctx: SharedTestContext;
  const cleanupTableIds: string[] = [];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  afterEach(async () => {
    for (const tableId of cleanupTableIds.splice(0)) {
      await ctx.deleteTable(tableId, { mode: 'permanent' });
    }
  });

  const readStoredMeta = async (tableId: string) => {
    const rows = await ctx.testContainer.db
      .selectFrom('view')
      .select(['id', 'column_meta'])
      .where('table_id', '=', tableId)
      .where('deleted_time', 'is', null)
      .execute();
    return new Map(
      rows.map((row) => {
        const parsed = ViewColumnMeta.create(JSON.parse(row.column_meta));
        if (parsed.isErr()) throw new Error(parsed.error.message);
        return [row.id, parsed.value.toDto()] as const;
      })
    );
  };

  const getSymmetricId = (field: { options?: unknown }) => {
    const options = field.options;
    if (
      !options ||
      typeof options !== 'object' ||
      !('symmetricFieldId' in options) ||
      typeof options.symmetricFieldId !== 'string'
    ) {
      throw new Error('Expected a two-way link with a symmetric field ID');
    }
    return options.symmetricFieldId;
  };

  const createSource = async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Source',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    cleanupTableIds.push(table.id);
    return table;
  };

  const createTarget = async (name: string): Promise<TargetFixture> => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name,
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'Notes' },
      ],
      views: [
        { type: 'grid', name: 'All fields' },
        { type: 'grid', name: 'Customized grid' },
        { type: 'gallery', name: 'Customized gallery' },
      ],
    });
    cleanupTableIds.push(table.id);
    const notesId = table.fields.find((field) => field.name === 'Notes')!.id;
    const customizedGridId = table.views[1].id;
    const customizedGalleryId = table.views[2].id;
    for (const [viewId, columnMeta] of [
      [customizedGridId, { hidden: true, order: 12.5, width: 240 }],
      [customizedGalleryId, { visible: false, order: 7.25 }],
    ] as const) {
      const result = await client.tables.updateViewColumnMeta({
        tableId: table.id,
        viewId,
        columnMeta: [{ fieldId: notesId, columnMeta }],
      });
      expect(result.ok).toBe(true);
    }
    return {
      tableId: table.id,
      primaryFieldId: table.fields.find((field) => field.isPrimary)!.id,
      initialMeta: await readStoredMeta(table.id),
      customizedGridId,
      customizedGalleryId,
    };
  };

  const createLink = async (sourceId: string, target: TargetFixture, isOneWay: boolean) => {
    const table = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceId,
      field: {
        type: 'link',
        name: 'Target',
        options: {
          relationship: 'manyMany',
          foreignTableId: target.tableId,
          lookupFieldId: target.primaryFieldId,
          isOneWay,
        },
      },
    });
    return table.fields.find((field) => field.name === 'Target')!;
  };

  const updateLink = async (
    sourceId: string,
    fieldId: string,
    target: TargetFixture,
    isOneWay: boolean
  ) => {
    const table = await ctx.updateField({
      tableId: sourceId,
      fieldId,
      field: {
        options: {
          relationship: 'manyMany',
          foreignTableId: target.tableId,
          lookupFieldId: target.primaryFieldId,
          isOneWay,
        },
      },
    });
    return table.fields.find((field) => field.id === fieldId)!;
  };

  const assertStoredViews = async (target: TargetFixture, addedFieldIds: string[] = []) => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
    const stored = await readStoredMeta(target.tableId);
    const freshTable = await ctx.getTableById(target.tableId);
    expect([...stored.keys()].sort()).toEqual([...target.initialMeta.keys()].sort());
    for (const [viewId, columnMeta] of stored) {
      expect(Object.keys(columnMeta).sort()).toEqual(
        freshTable.fields.map((field) => field.id).sort()
      );
      for (const [fieldId, previous] of Object.entries(target.initialMeta.get(viewId)!)) {
        expect(columnMeta[fieldId]).toEqual(previous);
      }
      for (const fieldId of addedFieldIds) {
        expect(Number.isFinite(columnMeta[fieldId]?.order)).toBe(true);
        expect(columnMeta[fieldId].order).toBeGreaterThan(
          Math.max(
            ...Object.values(target.initialMeta.get(viewId)!)
              .map((entry) => entry.order)
              .filter((order): order is number => typeof order === 'number')
          )
        );
      }
      const freshView = await client.tables.getView({ tableId: target.tableId, viewId });
      expect(freshView.data.view.columnMeta).toEqual(columnMeta);
      expect(freshTable.views.find((view) => view.id === viewId)!.columnMeta).toEqual(columnMeta);
    }
    for (const fieldId of addedFieldIds) {
      expect(stored.get(target.customizedGridId)![fieldId].hidden).toBe(true);
      expect(stored.get(target.customizedGalleryId)![fieldId].visible).toBe(false);
    }
  };

  // Preparing the old reciprocal entry through the public API isolates removal
  // from the separate creation bug: the entry must really exist before deletion.
  const configureExistingReciprocal = async (target: TargetFixture, fieldId: string) => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
    for (const viewId of target.initialMeta.keys()) {
      const result = await client.tables.updateViewColumnMeta({
        tableId: target.tableId,
        viewId,
        columnMeta: [{ fieldId, columnMeta: { order: 20 } }],
      });
      expect(result.ok).toBe(true);
      const before = await readStoredMeta(target.tableId);
      expect(before.get(viewId)![fieldId].order).toBe(20);
    }
  };

  test('persists reciprocal entries after one-way becomes two-way', async () => {
    const source = await createSource();
    const target = await createTarget('Target');
    const link = await createLink(source.id, target, true);
    const updated = await updateLink(source.id, link.id, target, false);
    const symmetricFieldId = getSymmetricId(updated);
    await assertStoredViews(target, [symmetricFieldId]);
  });

  test('retargets a two-way link without leaving old view entries or losing new ones', async () => {
    const source = await createSource();
    const previousTarget = await createTarget('Previous target');
    const nextTarget = await createTarget('Next target');
    const link = await createLink(source.id, previousTarget, false);
    const previousSymmetricId = getSymmetricId(link);
    await configureExistingReciprocal(previousTarget, previousSymmetricId);

    const updated = await updateLink(source.id, link.id, nextTarget, false);
    const nextSymmetricId = getSymmetricId(updated);

    await assertStoredViews(previousTarget);
    await assertStoredViews(nextTarget, [nextSymmetricId]);
  });

  test('removes reciprocal view entries when two-way becomes one-way', async () => {
    const source = await createSource();
    const target = await createTarget('Target');
    const link = await createLink(source.id, target, false);
    const symmetricId = getSymmetricId(link);
    await configureExistingReciprocal(target, symmetricId);

    await updateLink(source.id, link.id, target, true);

    await assertStoredViews(target);
  });

  test('persists reciprocal entries when a two-way link is first created', async () => {
    const source = await createSource();
    const target = await createTarget('Target');
    const link = await createLink(source.id, target, false);
    const symmetricId = getSymmetricId(link);

    await assertStoredViews(target, [symmetricId]);
  });

  test('removes reciprocal view entries when the source link is deleted', async () => {
    const source = await createSource();
    const target = await createTarget('Target');
    const link = await createLink(source.id, target, false);
    const symmetricId = getSymmetricId(link);
    await configureExistingReciprocal(target, symmetricId);

    await ctx.deleteField({ tableId: source.id, fieldId: link.id });

    await assertStoredViews(target);
  });

  test('keeps all reciprocal entries for multiple new links to the same target', async () => {
    const target = await createTarget('Target');
    const source = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Source with multiple links',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        ...['First link', 'Second link'].map((name) => ({
          type: 'link' as const,
          name,
          options: {
            foreignTableId: target.tableId,
            lookupFieldId: target.primaryFieldId,
            relationship: 'manyMany' as const,
            isOneWay: false,
          },
        })),
      ],
    });
    cleanupTableIds.unshift(source.id);
    const links = ['First link', 'Second link'].map((name) =>
      source.fields.find((field) => field.name === name)!
    );
    const symmetricIds = links.map(getSymmetricId);

    await assertStoredViews(target, symmetricIds);
    for (const field of links) {
      await configureExistingReciprocal(target, getSymmetricId(field));
    }
    const deleted = await getCommandBus(ctx).execute(
      buildUndoRedoContext(),
      DeleteFieldsCommand.create({
        baseId: ctx.baseId,
        tableId: source.id,
        fieldIds: links.map((field) => field.id),
      })._unsafeUnwrap()
    );
    if (deleted.isErr()) throw new Error(deleted.error.message);
    await assertStoredViews(target);
  });

  test('keeps source and reciprocal metadata when a self-link becomes two-way', async () => {
    const target = await createTarget('Self link');
    const link = await createLink(target.tableId, target, true);
    const updated = await updateLink(target.tableId, link.id, target, false);

    await assertStoredViews(target, [link.id, getSymmetricId(updated)]);
  });

  test('restores reciprocal metadata when a link conversion is undone', async () => {
    const source = await createSource();
    const target = await createTarget('Undo target');
    const link = await createLink(source.id, target, true);
    const windowId = 'reciprocal-view-metadata-undo';
    const converted = await getCommandBus(ctx).execute(
      buildUndoRedoContext(windowId),
      UpdateFieldCommand.create({
        tableId: source.id,
        fieldId: link.id,
        field: {
          options: {
            relationship: 'manyMany',
            foreignTableId: target.tableId,
            lookupFieldId: target.primaryFieldId,
            isOneWay: false,
          },
        },
      })._unsafeUnwrap()
    );
    if (converted.isErr()) throw new Error(converted.error.message);
    const fresh = await ctx.getTableById(source.id);
    const symmetricId = getSymmetricId(fresh.fields.find((field) => field.id === link.id)!);
    await assertStoredViews(target, [symmetricId]);
    await executeUndo(ctx, source.id, windowId);
    await assertStoredViews(target);
    // Redo is out of scope: undo-then-redo of a two-way conversion already collides on
    // uniq___fk_<source>___fk_<symmetric> before this change (baseline fa8aa53d8d).
  });
  test.each([false, true])(
    'persists reciprocal metadata through text/link conversions (self=%s)',
    async (self) => {
      const source = await createSource();
      const target = await createTarget('Type conversion target');
      const tableId = self ? target.tableId : source.id;
      const sourceAfterCreate = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'singleLineText', name: 'Convertible' },
      });
      const textFieldId = sourceAfterCreate.fields.find(
        (field) => field.name === 'Convertible'
      )!.id;
      // A self-link's text field is part of the pre-conversion state, not a reciprocal addition.
      const beforeConversion = self
        ? { ...target, initialMeta: await readStoredMeta(target.tableId) }
        : target;
      const converted = await ctx.updateField({
        tableId,
        fieldId: textFieldId,
        field: {
          type: 'link',
          options: {
            foreignTableId: target.tableId,
            lookupFieldId: target.primaryFieldId,
            relationship: 'manyMany',
            isOneWay: false,
          },
        },
      });
      const link = converted.fields.find((field) => field.id === textFieldId)!;
      const symmetricId = getSymmetricId(link);
      await assertStoredViews(beforeConversion, [symmetricId]);

      await ctx.updateField({ tableId, fieldId: textFieldId, field: { type: 'singleLineText' } });
      await assertStoredViews(beforeConversion);
    }
  );
});
