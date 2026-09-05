/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

// T7144: sanitized structure from a oneMany rollup over a scalar member field.
describe('rollup member array_unique to countall', () => {
  let ctx: SharedTestContext;
  const tableIds: string[] = [];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  afterAll(async () => {
    for (const tableId of tableIds.reverse()) await ctx.deleteTable(tableId);
  });

  it('converts a persisted string array rollup with numeric formatting', async () => {
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Member source',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        { name: 'Member', type: 'user', options: { isMultiple: false, shouldNotify: false } },
      ],
    });
    tableIds.push(foreign.id);
    const member = foreign.fields.find((f) => f.name === 'Member')!;
    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Member summary',
      fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
    });
    tableIds.push(host.id);
    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: host.id,
      field: {
        name: 'Sources',
        type: 'link',
        options: { relationship: 'oneMany', foreignTableId: foreign.id },
      },
    });
    const link = withLink.fields.find((f) => f.name === 'Sources')!;
    const withRollup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: host.id,
      field: {
        name: 'Members',
        type: 'rollup',
        description: 'Member aggregate description',
        options: { expression: 'array_unique({values})', timeZone: 'Asia/Singapore' },
        config: { linkFieldId: link.id, foreignTableId: foreign.id, lookupFieldId: member.id },
      },
    });
    const rollup = withRollup.fields.find((f) => f.name === 'Members')!;
    const first = await ctx.createRecord(foreign.id, {
      [member.id]: { id: ctx.testUser.id, title: ctx.testUser.name },
    });
    const second = await ctx.createRecord(foreign.id, {
      [member.id]: { id: ctx.testUser.id, title: ctx.testUser.name },
    });
    const record = await ctx.createRecord(host.id, {
      [link.id]: [{ id: first.id }, { id: second.id }],
    });
    const updated = await ctx.updateField({
      tableId: host.id,
      fieldId: rollup.id,
      field: {
        type: 'rollup',
        options: {
          expression: 'countall({values})',
          timeZone: 'Asia/Singapore',
          formatting: { type: 'decimal', precision: 2 },
        },
      },
    });
    expect(updated.fields.find((f) => f.id === rollup.id)?.options).toMatchObject({
      expression: 'countall({values})',
      formatting: { type: 'decimal', precision: 2 },
    });
    expect(updated.fields.find((f) => f.id === rollup.id)?.description).toBe(
      'Member aggregate description'
    );
    const records = await ctx.listRecords(host.id);
    expect(records.find((r) => r.id === record.id)?.fields[rollup.id]).toBe(2);

    // Reversing the result type must discard the inherited numeric formatting.
    const restored = await ctx.updateField({
      tableId: host.id,
      fieldId: rollup.id,
      field: { type: 'rollup', options: { expression: 'array_unique({values})' } },
    });
    expect(restored.fields.find((f) => f.id === rollup.id)?.options).not.toHaveProperty(
      'formatting'
    );
    const restoredRecords = await ctx.listRecords(host.id);
    expect(restoredRecords.find((r) => r.id === record.id)?.fields[rollup.id]).toHaveLength(1);

    // Explicit formatting still has to match the final result type.
    await expect(
      ctx.updateField({
        tableId: host.id,
        fieldId: rollup.id,
        field: {
          type: 'rollup',
          options: {
            expression: 'array_compact({values})',
            formatting: { type: 'decimal', precision: 2 },
          },
        },
      })
    ).rejects.toThrow('Invalid RollupField formatting');
  });
});
