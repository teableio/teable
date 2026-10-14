/**
 * S14 — rating configuration and the max-reduction policy.
 *
 * S14 (实现依据): the rating field exposes 8 icons, 3 colours and a max in
 * 1–10. The requirement document leaves "改最大值后的已有评分保留/截断/拒绝"
 * open; v2 answer: existing values are **clamped** to the new maximum.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

/** S14 — the eight icons the document lists. */
const RATING_ICONS = ['star', 'moon', 'sun', 'zap', 'flame', 'heart', 'apple', 'thumb-up'] as const;

/** S14 — the three colours the document lists. */
const RATING_COLORS = ['yellowBright', 'redBright', 'tealBright'] as const;

/** S14 — the max domain from the document. */
const LEGAL_MAX = [1, 2, 5, 10] as const;
const ILLEGAL_MAX = [0, 11, -1, 5.5] as const;

describe('S14: rating configuration', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldSeq = 0;
  const nameOf = (prefix: string) => `${prefix}-${(fieldSeq += 1)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'S14 Rating Formatting',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const createRating = async (prefix: string, options: Record<string, unknown> = {}) => {
    const name = nameOf(prefix);
    const table = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'rating', name, options },
    });
    return fieldByName(table, name);
  };

  describe('S14 icon catalogue', () => {
    it.each(RATING_ICONS)('round-trips the %s icon', async (icon) => {
      const field = await createRating('Rating-icon', { max: 5, icon, color: 'yellowBright' });
      const reloaded = await ctx.getTableById(tableId);
      const options = fieldOptions(reloaded.fields.find((item) => item.id === field.id));
      expect(options.icon).toBe(icon);
      expect(options.max).toBe(5);
    });

    it('rejects an unknown icon', async () => {
      await expect(
        createRating('Rating-icon-invalid', { max: 5, icon: 'diamond', color: 'yellowBright' })
      ).rejects.toThrow();
    });
  });

  describe('S14 colour catalogue', () => {
    it.each(RATING_COLORS)('round-trips the %s colour', async (color) => {
      const field = await createRating('Rating-color', { max: 5, icon: 'star', color });
      const reloaded = await ctx.getTableById(tableId);
      expect(fieldOptions(reloaded.fields.find((item) => item.id === field.id)).color).toBe(color);
    });

    it('rejects an unknown colour', async () => {
      await expect(
        createRating('Rating-color-invalid', { max: 5, icon: 'star', color: 'blueBright' })
      ).rejects.toThrow();
    });
  });

  describe('S14 max domain', () => {
    it.each(LEGAL_MAX)('accepts max %i', async (max) => {
      const field = await createRating('Rating-max', { max, icon: 'star', color: 'yellowBright' });
      const reloaded = await ctx.getTableById(tableId);
      expect(fieldOptions(reloaded.fields.find((item) => item.id === field.id)).max).toBe(max);
    });

    it.each(ILLEGAL_MAX)('rejects max %s', async (max) => {
      await expect(
        createRating('Rating-max-invalid', { max, icon: 'star', color: 'yellowBright' })
      ).rejects.toThrow();
    });

    it('defaults to max 5 when omitted', async () => {
      const field = await createRating('Rating-max-default');
      expect(fieldOptions(field).max).toBe(5);
    });
  });

  describe('S14 max reduction policy', () => {
    test('clamps stored values above the new maximum', async () => {
      const field = await createRating('Rating-clamp', {
        max: 10,
        icon: 'star',
        color: 'yellowBright',
      });
      const overMax = await ctx.createRecord(tableId, { [field.id]: 9 });
      const atMax = await ctx.createRecord(tableId, { [field.id]: 10 });
      const underMax = await ctx.createRecord(tableId, { [field.id]: 3 });

      await ctx.updateField({
        tableId,
        fieldId: field.id,
        field: { options: { max: 5, icon: 'star', color: 'yellowBright' } },
      });

      await expect(readValue(ctx, tableId, overMax.id, field.id)).resolves.toBe(5);
      await expect(readValue(ctx, tableId, atMax.id, field.id)).resolves.toBe(5);
      // Values already inside the new range are untouched.
      await expect(readValue(ctx, tableId, underMax.id, field.id)).resolves.toBe(3);
    });

    test('raising the maximum leaves every stored value alone', async () => {
      const field = await createRating('Rating-raise', {
        max: 3,
        icon: 'star',
        color: 'yellowBright',
      });
      const record = await ctx.createRecord(tableId, { [field.id]: 3 });

      await ctx.updateField({
        tableId,
        fieldId: field.id,
        field: { options: { max: 10, icon: 'star', color: 'yellowBright' } },
      });

      await expect(readValue(ctx, tableId, record.id, field.id)).resolves.toBe(3);
    });

    test('rejects a value above the configured maximum', async () => {
      const field = await createRating('Rating-overflow', {
        max: 3,
        icon: 'star',
        color: 'yellowBright',
      });
      await expect(ctx.createRecord(tableId, { [field.id]: 4 })).rejects.toThrow();
    });

    test('S07-style cosmetic change keeps the stored rating', async () => {
      const field = await createRating('Rating-cosmetic', {
        max: 5,
        icon: 'star',
        color: 'yellowBright',
      });
      const record = await ctx.createRecord(tableId, { [field.id]: 4 });

      await ctx.updateField({
        tableId,
        fieldId: field.id,
        field: { options: { max: 5, icon: 'heart', color: 'tealBright' } },
      });

      await expect(readValue(ctx, tableId, record.id, field.id)).resolves.toBe(4);
      const reloaded = await ctx.getTableById(tableId);
      const row = findRow(await ctx.listRecords(tableId, { limit: 1000 }), record.id);
      expect(row?.fields[field.id]).toBe(4);
      expect(fieldOptions(reloaded.fields.find((item) => item.id === field.id))).toMatchObject({
        icon: 'heart',
        color: 'tealBright',
        max: 5,
      });
    });
  });
});
