/**
 * B05 — button configuration and its effect boundary.
 *
 * B05 (实现依据): the requirement document asks for the button's label, colour,
 * available state, click limit, and what a click is allowed to change. Display
 * settings and the click limit are field configuration. The stored `{ count }`
 * cell tracks clicks and can also be written directly through the record API.
 *
 * The workflow a click triggers is executed by the host automation runtime, so
 * this spec pins the configuration contract and the write boundary rather than
 * the workflow body.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

/** The button colours the document lists. */
const BUTTON_COLORS = ['blue', 'green', 'yellow', 'red'] as const;

describe('B05: button configuration', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let seq = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'B05 Buttons',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const createButton = async (options: Record<string, unknown>) => {
    seq += 1;
    const name = `B05-${seq}`;
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'button', name, options },
    });
    return fieldByName(created, name);
  };

  it.each(BUTTON_COLORS)('round-trips the %s colour', async (color) => {
    const field = await createButton({ label: 'Run', color });
    const reloaded = await ctx.getTableById(tableId);
    const options = fieldOptions(reloaded.fields.find((f) => f.id === field.id));
    expect(options.color).toBe(color);
    expect(options.label).toBe('Run');
  });

  it('round-trips the click budget and its reset flag', async () => {
    const field = await createButton({
      label: 'Run twice',
      color: 'blue',
      maxCount: 2,
      resetCount: true,
    });
    const reloaded = await ctx.getTableById(tableId);
    const options = fieldOptions(reloaded.fields.find((f) => f.id === field.id));
    expect(options.maxCount).toBe(2);
    expect(options.resetCount).toBe(true);
  });

  it('round-trips an attached workflow reference', async () => {
    const field = await createButton({
      label: 'Notify',
      color: 'green',
      workflow: { id: 'wflB05', name: 'Notify the owner' },
    });
    const reloaded = await ctx.getTableById(tableId);
    expect(fieldOptions(reloaded.fields.find((f) => f.id === field.id)).workflow).toEqual({
      id: 'wflB05',
      name: 'Notify the owner',
    });
  });

  it('updates the label and colour without touching record values', async () => {
    const field = await createButton({ label: 'Before', color: 'blue' });
    const record = await ctx.createRecord(tableId, {});
    const before = findRow(await ctx.listRecords(tableId, { limit: 1000 }), record.id);

    const updated = await ctx.updateField({
      tableId,
      fieldId: field.id,
      field: { options: { label: 'After', color: 'red' } },
    });
    const options = fieldOptions(fieldByName(updated, field.name));
    expect(options.label).toBe('After');
    expect(options.color).toBe('red');

    const after = findRow(await ctx.listRecords(tableId, { limit: 1000 }), record.id);
    expect(after?.fields[field.id] ?? null).toBe(before?.fields[field.id] ?? null);
  });

  describe('button configuration and stored click counts remain separate', () => {
    it('rejects malformed input and persists a count supplied on create', async () => {
      const field = await createButton({ label: 'Run', color: 'blue' });
      await expect(ctx.createRecord(tableId, { [field.id]: 'clicked' })).rejects.toThrow(
        'validation.field.invalid_value'
      );
      const record = await ctx.createRecord(tableId, { [field.id]: { count: 3 } });
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[field.id]).toEqual({ count: 3 });
    });

    it('rejects malformed updates and persists an explicit count update', async () => {
      const field = await createButton({ label: 'Run', color: 'blue' });
      const record = await ctx.createRecord(tableId, {});
      await expect(ctx.updateRecord(tableId, record.id, { [field.id]: 'clicked' })).rejects.toThrow(
        'validation.field.invalid_value'
      );
      await ctx.updateRecord(tableId, record.id, { [field.id]: { count: 3 } });

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[field.id]).toEqual({ count: 3 });
    });

    it('reads an untouched button as empty when a formula references it', async () => {
      // A button with no stored count contributes an empty value to the formula.
      const field = await createButton({ label: 'Run', color: 'blue' });
      seq += 1;
      const formulaName = `B05-formula-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: formulaName,
          options: { expression: `{${field.id}}` },
        },
      });
      const formulaId = fieldByName(created, formulaName).id;

      const record = await ctx.createRecord(tableId, {});
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[formulaId] ?? null).toBeNull();
    });

    it('offers no user default and no statistic', async () => {
      const field = await createButton({ label: 'Run', color: 'blue', defaultValue: 'x' } as never);
      const reloaded = await ctx.getTableById(tableId);
      expect(
        fieldOptions(reloaded.fields.find((f) => f.id === field.id)).defaultValue
      ).toBeUndefined();
    });
  });
});
