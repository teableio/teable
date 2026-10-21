/**
 * F18 / B02 — lastModifiedBy property updates and tracking scope.
 *
 * Requirement IDs: F18 (system generated, `trackedFieldIds` scope), B02 (tracked fields).
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('[D01][S01] F18: lastModifiedBy property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldSeq = 0;

  const nextFieldId = () => {
    fieldSeq += 1;
    return `fld${fieldSeq.toString(36).padStart(16, '0')}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'lastModifiedBy Update Test',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('updates the name and tracking list together', async () => {
    const fieldId = nextFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'lastModifiedBy', id: fieldId, name: 'Editor' },
    });
    const trackedId = fieldByName(created, 'Name').id;

    const updated = await ctx.updateField({
      tableId,
      fieldId,
      field: { name: 'Editor Updated', options: { trackedFieldIds: [trackedId] } },
    });

    const field = fieldByName(updated, 'Editor Updated');
    expect(field.type).toBe('lastModifiedBy');
    expect(fieldOptions(field).trackedFieldIds).toEqual([trackedId]);

    await ctx.deleteField({ tableId, fieldId });
  });

  test('B02 an edit outside the tracking list leaves the actor alone', async () => {
    const fieldId = nextFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'lastModifiedBy', id: fieldId, name: 'Editor Scoped' },
    });
    const trackedId = fieldByName(created, 'Name').id;

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { trackedFieldIds: [trackedId] } },
    });

    // A second, untracked column: writing it must not advance the actor.
    const extra = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'singleLineText', name: 'Untracked' },
    });
    const untrackedId = fieldByName(extra, 'Untracked').id;

    const record = await ctx.createRecord(tableId, {});
    const before = await readValue(ctx, tableId, record.id, fieldId);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await ctx.updateRecord(tableId, record.id, { [untrackedId]: 'changed' });

    await expect(readValue(ctx, tableId, record.id, fieldId)).resolves.toEqual(before);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record.id]);
  });
});
