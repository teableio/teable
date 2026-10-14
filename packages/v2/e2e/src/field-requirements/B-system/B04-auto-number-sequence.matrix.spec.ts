/**
 * B04 — auto number allocation.
 *
 * B04 (实现依据): the requirement document asks about uniqueness under
 * concurrency and bulk create, and about the sequence policy after deletes.
 * v2 answer: numbers are allocated monotonically from the table sequence and
 * are never reused, so a delete leaves a permanent gap. Gaps are not a defect —
 * the document already states continuity is not promised.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';
import {
  fieldByName,
  findRow,
  getSharedTestContext,
  readAllValues,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('B04: auto number allocation', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let autoNumberId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'B04 Auto Number',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'autoNumber', name: 'Number' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    autoNumberId = fieldByName(table, 'Number').id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('B04 the serial is assigned on create and not on the create payload', async () => {
    const record = await ctx.createRecord(tableId, {});
    // The write response omits the computed projection, so the value must be
    // read back through the query path.
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    expect(findRow(rows, record.id)?.fields[autoNumberId]).toBe(1);
  });

  test('B04 sequential creates allocate strictly increasing numbers', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'B04 Sequential',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'autoNumber', name: 'Number' },
      ],
      views: [{ type: 'grid' }],
    });
    const fieldId = fieldByName(table, 'Number').id;

    const created: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      created.push((await ctx.createRecord(table.id, {})).id);
    }

    const values = await readAllValues(ctx, table.id, fieldId);
    expect(values).toEqual([1, 2, 3, 4]);

    await ctx.deleteTable(table.id);
    expect(created).toHaveLength(4);
  });

  test('B04 a batch create allocates a distinct number per record', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'B04 Batch',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'autoNumber', name: 'Number' },
      ],
      views: [{ type: 'grid' }],
    });
    const fieldId = fieldByName(table, 'Number').id;

    const records = await ctx.createRecords(table.id, [
      { fields: {} },
      { fields: {} },
      { fields: {} },
    ]);

    const rows = await ctx.listRecords(table.id, { limit: 1000 });
    const numbers = records.map((record) => findRow(rows, record.id)?.fields[fieldId]);
    expect(new Set(numbers).size).toBe(records.length);
    expect([...numbers].sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3]);

    await ctx.deleteTable(table.id);
  });

  test('B04 a deleted number is not reused', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'B04 Reuse',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'autoNumber', name: 'Number' },
      ],
      views: [{ type: 'grid' }],
    });
    const fieldId = fieldByName(table, 'Number').id;

    const first = await ctx.createRecord(table.id, {});
    const second = await ctx.createRecord(table.id, {});
    await ctx.deleteRecord(table.id, second.id);
    const third = await ctx.createRecord(table.id, {});

    const rows = await ctx.listRecords(table.id, { limit: 1000 });
    expect(findRow(rows, first.id)?.fields[fieldId]).toBe(1);
    expect(findRow(rows, third.id)?.fields[fieldId]).toBe(3);

    await ctx.deleteTable(table.id);
  });

  test('B04 concurrent creates never collide', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'B04 Concurrency',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'autoNumber', name: 'Number' },
      ],
      views: [{ type: 'grid' }],
    });
    const fieldId = fieldByName(table, 'Number').id;

    const created = await Promise.all(
      Array.from({ length: 6 }, () => ctx.createRecord(table.id, {}))
    );

    const values = await readAllValues(ctx, table.id, fieldId);
    expect(values).toHaveLength(created.length);
    expect(new Set(values).size).toBe(created.length);
    // Strictly positive integers only.
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
      expect(Number(value)).toBeGreaterThan(0);
    }

    await ctx.deleteTable(table.id);
  });

  test('B04 deleting the field does not resurrect a stale sequence on re-add', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'B04 Re-add',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'autoNumber', name: 'Number' },
      ],
      views: [{ type: 'grid' }],
    });
    const fieldId = fieldByName(table, 'Number').id;
    await ctx.createRecords(table.id, [{ fields: {} }, { fields: {} }]);
    expect(await readAllValues(ctx, table.id, fieldId)).toEqual([1, 2]);

    await ctx.deleteField({ tableId: table.id, fieldId });
    const restored = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: { type: 'autoNumber', name: 'Number again' },
    });
    const newFieldId = fieldByName(restored, 'Number again').id;
    const record = await ctx.createRecord(table.id, {});

    const rows = await ctx.listRecords(table.id, { limit: 1000 });
    const value = findRow(rows, record.id)?.fields[newFieldId];
    expect(Number.isInteger(value)).toBe(true);
    expect(Number(value)).toBeGreaterThan(0);

    await ctx.deleteTable(table.id);
  });

  describe('B04 the serial cannot be written', () => {
    it('ignores an explicit value on create', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'B04 Write Guard',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'autoNumber', name: 'Number' },
        ],
        views: [{ type: 'grid' }],
      });
      const fieldId = fieldByName(table, 'Number').id;
      const record = await ctx.createRecord(table.id, { [fieldId]: 999 });

      const rows = await ctx.listRecords(table.id, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[fieldId]).toBe(1);

      await ctx.deleteTable(table.id);
    });

    it('ignores an update payload that only carries the serial', async () => {
      const record = await ctx.createRecord(tableId, {});
      const before = findRow(await ctx.listRecords(tableId, { limit: 1000 }), record.id);
      expect(before).toBeDefined();
      const original = before!.fields[autoNumberId];

      const updated = await ctx.updateRecord(tableId, record.id, { [autoNumberId]: 500 });
      expect(updated.fields[autoNumberId]).toBe(original);

      const after = findRow(await ctx.listRecords(tableId, { limit: 1000 }), record.id);
      expect(after?.fields).toEqual(before!.fields);
    });
  });
});
