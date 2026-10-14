/**
 * F20 — button property updates.
 *
 * Requirement IDs: F20 (button holds configuration, not a cell value).
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('[D01][S01] F20: button property updates', () => {
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
      name: 'button Update Test',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('updates a single property without resetting the others', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'button',
        id: fieldId,
        name: 'Run',
        options: { label: 'Run', color: 'blue', maxCount: 5, resetCount: true },
      },
    });

    const updated = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { label: 'Run now' } },
    });
    const options = fieldOptions(updated.fields.find((f) => f.id === fieldId));
    expect(options.label).toBe('Run now');
    expect(options.color).toBe('blue');
    expect(options.maxCount).toBe(5);
    expect(options.resetCount).toBe(true);

    await ctx.deleteField({ tableId, fieldId });
  });

  test('clears the click budget when the limit is removed', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'button',
        id: fieldId,
        name: 'Limited',
        options: { label: 'Limited', color: 'red', maxCount: 3, resetCount: true },
      },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: { label: 'Limited', color: 'red', maxCount: null, resetCount: false } as never,
      },
    });

    const options = fieldOptions(fieldByName(await ctx.getTableById(tableId), 'Limited'));
    expect(options.maxCount ?? null).toBeNull();
    expect(options.resetCount).toBe(false);

    await ctx.updateField({ tableId, fieldId, field: { options: { maxCount: 1 } } });
    const reenabled = fieldOptions(fieldByName(await ctx.getTableById(tableId), 'Limited'));
    expect(reenabled.maxCount).toBe(1);
    expect(reenabled.resetCount).toBe(false);

    await ctx.deleteField({ tableId, fieldId });
  });

  test.each([0, -1, 1.5])(
    'rejects maxCount %s without changing the saved limit',
    async (maxCount) => {
      const fieldId = nextFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'button',
          id: fieldId,
          name: `Limit ${fieldId}`,
          options: { label: 'Run', color: 'teal', maxCount: 3 },
        },
      });

      const before = await ctx.listRecords(tableId);
      for (const type of [undefined, '']) {
        await expect(
          ctx.updateField({ tableId, fieldId, field: { type, options: { maxCount } } })
        ).rejects.toThrow();
        const table = await ctx.getTableById(tableId);
        expect(fieldOptions(table.fields.find((field) => field.id === fieldId))).toEqual({
          label: 'Run',
          color: 'teal',
          maxCount: 3,
        });
        expect(await ctx.listRecords(tableId)).toEqual(before);
      }

      await ctx.updateField({ tableId, fieldId, field: { options: { maxCount: 10 } } });
      const updated = await ctx.getTableById(tableId);
      expect(fieldOptions(updated.fields.find((field) => field.id === fieldId)).maxCount).toBe(10);
      await ctx.deleteField({ tableId, fieldId });
    }
  );

  test.each([0, -1, 1.5])(
    'rejects conversion to button with maxCount %s before changing data',
    async (maxCount) => {
      const fieldId = nextFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { id: fieldId, type: 'singleLineText', name: `Text ${fieldId}` },
      });
      await ctx.createRecord(tableId, { [fieldId]: 'Keep original text' });
      const before = await ctx.listRecords(tableId);
      await expect(
        ctx.updateField({
          tableId,
          fieldId,
          field: { type: 'button', options: { label: 'Run', color: 'teal', maxCount } },
        })
      ).rejects.toThrow();
      const after = await ctx.getTableById(tableId);
      expect(after.fields.find((field) => field.id === fieldId)?.type).toBe('singleLineText');
      expect(await ctx.listRecords(tableId)).toEqual(before);
      await ctx.deleteField({ tableId, fieldId });
    }
  );

  test('accepts a new button after its limit is disabled', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        id: fieldId,
        type: 'button',
        name: 'New unlimited',
        options: { label: 'Run', color: 'teal', maxCount: null, resetCount: false },
      },
    });
    const after = await ctx.getTableById(tableId);
    const options = fieldOptions(after.fields.find((field) => field.id === fieldId));
    expect(options.maxCount).toBeUndefined();
    expect(options.resetCount).toBe(false);
    await ctx.deleteField({ tableId, fieldId });
  });

  test('rejects an unknown colour', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'button',
        id: fieldId,
        name: 'Bad Colour',
        options: { label: 'Bad', color: 'blue' },
      },
    });

    await expect(
      ctx.updateField({
        tableId,
        fieldId,
        field: { options: { label: 'Bad', color: 'chartreuse' } as never },
      })
    ).rejects.toThrow();

    await ctx.deleteField({ tableId, fieldId });
  });
});
