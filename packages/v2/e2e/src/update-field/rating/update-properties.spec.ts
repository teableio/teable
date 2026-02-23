import type { IFieldDto } from '@teable/v2-contract-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { RatingIcon } from '@teable/v2-core';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

type RatingFieldDto = IFieldDto & {
  type: 'rating';
  options?: {
    max?: number;
    icon?: string;
    color?: 'redBright' | 'tealBright' | 'yellowBright';
  };
};

const isRatingField = (field: IFieldDto | undefined): field is RatingFieldDto => {
  return field?.type === 'rating';
};

describe('update-field: rating property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createRatingField = async (
    name: string,
    options: { max: number; icon?: RatingIcon; color?: 'redBright' | 'tealBright' | 'yellowBright' }
  ) => {
    const fieldOptions: NonNullable<RatingFieldDto['options']> = {
      max: options.max,
      ...(options.icon ? { icon: options.icon.toString() } : {}),
      ...(options.color ? { color: options.color } : {}),
    };

    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'rating',
        id: fieldId,
        name,
        options: fieldOptions,
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rating Property Updates',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) {
      await ctx.deleteTable(tableId).catch(() => {});
    }
  });

  // ============ Max value changes ============

  test('should increase max value', async () => {
    const fieldId = await createRatingField('Increase Max', { max: 5 });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 3 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 5 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { max: 10 } },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isRatingField(field)).toBe(true);
    if (isRatingField(field)) {
      expect(field.options?.max).toBe(10);
    }

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(1);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(3);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe(5);

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should reduce max value and clamp records', async () => {
    const fieldId = await createRatingField('Reduce Max', { max: 10 });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 2 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 5 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 8 });
    const r4 = await ctx.createRecord(tableId, { [fieldId]: 10 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { max: 5 } },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isRatingField(field)).toBe(true);
    if (isRatingField(field)) {
      expect(field.options?.max).toBe(5);
    }

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(2);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(5);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe(5);
    expect(records.find((r) => r.id === r4.id)?.fields[fieldId]).toBe(5);

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should reduce max value to 1', async () => {
    const fieldId = await createRatingField('Reduce Max to 1', { max: 5 });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 3 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 5 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { max: 1 } },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(1);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(1);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe(1);

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should preserve null values when reducing max', async () => {
    const fieldId = await createRatingField('Null Preservation', { max: 10 });
    const r1 = await ctx.createRecord(tableId, {});
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 5 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 8 });

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { max: 5 } },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBeNull();
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(5);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe(5);

    await ctx.deleteField({ tableId, fieldId });
  });

  // ============ Icon changes ============

  test('should update icon', async () => {
    const fieldId = await createRatingField('Update Icon', { max: 5, icon: RatingIcon.star() });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 3 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { max: 5, icon: 'heart' } },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isRatingField(field)).toBe(true);
    if (isRatingField(field)) {
      expect(field.options?.icon).toBe('heart');
    }

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(3);

    await ctx.deleteField({ tableId, fieldId });
  });

  // ============ Color changes ============

  test('should update color', async () => {
    const fieldId = await createRatingField('Update Color', { max: 5, color: 'yellowBright' });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 3 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { max: 5, color: 'redBright' } },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isRatingField(field)).toBe(true);
    if (isRatingField(field)) {
      expect(field.options?.color).toBe('redBright');
    }

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(3);

    await ctx.deleteField({ tableId, fieldId });
  });

  // ============ Combined updates ============

  test('should update max and icon together', async () => {
    const fieldId = await createRatingField('Combined Update', { max: 5, icon: RatingIcon.star() });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 3 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 5 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { max: 3, icon: 'heart' } },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isRatingField(field)).toBe(true);
    if (isRatingField(field)) {
      expect(field.options?.max).toBe(3);
      expect(field.options?.icon).toBe('heart');
    }

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(3);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(3);

    await ctx.deleteField({ tableId, fieldId });
  });
});

describe('update-field: rating conversions', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createRatingField = async (name: string, options: { max: number }) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'rating', id: fieldId, name, options },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rating Conversions',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) {
      await ctx.deleteTable(tableId).catch(() => {});
    }
  });

  test('should convert rating to number', async () => {
    const fieldId = await createRatingField('Rating to Number', { max: 5 });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 3 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 5 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(field?.type).toBe('number');

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(1);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(3);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe(5);

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should convert rating to text', async () => {
    const fieldId = await createRatingField('Rating to Text', { max: 5 });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 3 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 5 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(field?.type).toBe('singleLineText');

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('1');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe('3');
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBe('5');

    await ctx.deleteField({ tableId, fieldId });
  });

  test('should convert rating to singleSelect with option generation', async () => {
    const fieldId = await createRatingField('Rating to Select', { max: 5 });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: 3 });
    const r3 = await ctx.createRecord(tableId, { [fieldId]: 5 });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(field?.type).toBe('singleSelect');

    const choices = (
      field?.options && 'choices' in field.options && Array.isArray(field.options.choices)
        ? field.options.choices
        : []
    ) as Array<{ name: string }>;
    expect(choices.map((c) => c.name).sort()).toEqual(['1', '3', '5']);

    const records = await ctx.listRecords(tableId);
    const v1 = records.find((r) => r.id === r1.id)?.fields[fieldId] as string;
    const v2 = records.find((r) => r.id === r2.id)?.fields[fieldId] as string;
    const v3 = records.find((r) => r.id === r3.id)?.fields[fieldId] as string;

    expect(['1', '3', '5']).toContain(v1);
    expect(['1', '3', '5']).toContain(v2);
    expect(['1', '3', '5']).toContain(v3);
    expect(v1).not.toBe(v2);
    expect(v2).not.toBe(v3);

    await ctx.deleteField({ tableId, fieldId });
  });
});
