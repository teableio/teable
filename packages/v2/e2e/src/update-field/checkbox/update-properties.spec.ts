/**
 * E2E tests for updating Checkbox field properties.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

type CheckboxFieldOptions = {
  defaultValue?: boolean;
};

describe('update-field: checkbox property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Checkbox Property Updates',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) {
      try {
        await ctx.deleteTable(tableId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('should update field name', async () => {
    // Setup: Create checkbox field named "Active"
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'checkbox', id: fieldId, name: 'Active' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: true });

    // Action: Update name to "Is Active"
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { name: 'Is Active' },
    });

    // Assert: Name changed, values preserved
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.name).toBe('Is Active');

    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    expect(rec1?.fields[fieldId]).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should set defaultValue to true', async () => {
    // Setup: Create checkbox field with no defaultValue
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'checkbox', id: fieldId, name: 'Default True' },
    });

    // Action: Update defaultValue to true
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { defaultValue: true } },
    });

    // Assert: New records get true by default
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect((updatedField?.options as CheckboxFieldOptions | undefined)?.defaultValue).toBe(true);

    const r1 = await ctx.createRecord(tableId, {});
    expect(r1.fields[fieldId]).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });

  test('should set defaultValue to false', async () => {
    // Setup: Create checkbox field
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'checkbox',
        id: fieldId,
        name: 'Default False',
        options: { defaultValue: true },
      },
    });

    // Action: Update defaultValue to false
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { defaultValue: false } },
    });

    // Assert: New records get false by default
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect((updatedField?.options as CheckboxFieldOptions | undefined)?.defaultValue).toBe(false);

    const r1 = await ctx.createRecord(tableId, {});
    expect(r1.fields[fieldId]).toBe(false);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id]);
  });
});

describe('update-field: checkbox conversions', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0').replace('0', '1'); // ensure unique for this describe
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Checkbox Conversions',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) {
      try {
        await ctx.deleteTable(tableId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('should convert checkbox to text', async () => {
    // Setup: Create checkbox field with values: true, false, null
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'checkbox', id: fieldId, name: 'toText' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: true });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: false });
    const r3 = await ctx.createRecord(tableId, {}); // null

    // Action: Convert to singleLineText
    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    // Assert: Values become "true", "false", null
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('true');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe('false');
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should convert checkbox to number', async () => {
    // Setup: Create checkbox field with values: true, false, null
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'checkbox', id: fieldId, name: 'toNumber' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: true });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: false });
    const r3 = await ctx.createRecord(tableId, {}); // null

    // Action: Convert to number
    await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    // Assert: Values become 1, 0, null
    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(1);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(0);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should convert checkbox to singleSelect with option generation', async () => {
    // Setup: Create checkbox field with values: true, false
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'checkbox', id: fieldId, name: 'toSingleSelect' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: true });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: false });

    // Action: Convert to singleSelect
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    // Assert:
    // - Values become "true", "false"
    // - Options auto-generated: [{name: "true", ...}, {name: "false", ...}]
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleSelect');
    const options = updatedField?.options as { choices: { name: string }[] };
    expect(options.choices.map((c) => c.name)).toContain('true');
    expect(options.choices.map((c) => c.name)).toContain('false');

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe('true');
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe('false');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should convert checkbox to multipleSelect with option generation', async () => {
    // Setup: Create checkbox field with values: true, false, null
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'checkbox', id: fieldId, name: 'toMultipleSelect' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: true });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: false });
    const r3 = await ctx.createRecord(tableId, {}); // null

    // Action: Convert to multipleSelect
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'multipleSelect' },
    });

    // Assert:
    // - Values become ["true"], ["false"], null
    // - Options auto-generated: [{name: "true", ...}, {name: "false", ...}]
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('multipleSelect');
    const options = updatedField?.options as { choices: { name: string }[] };
    expect(options.choices.map((c) => c.name)).toContain('true');
    expect(options.choices.map((c) => c.name)).toContain('false');

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toEqual(['true']);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toEqual(['false']);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should convert checkbox to rating', async () => {
    // Setup: Create checkbox field with values: true, false, null
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'checkbox', id: fieldId, name: 'toRating' },
    });
    const r1 = await ctx.createRecord(tableId, { [fieldId]: true });
    const r2 = await ctx.createRecord(tableId, { [fieldId]: false });
    const r3 = await ctx.createRecord(tableId, {}); // null

    // Action: Convert to rating with max: 5
    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: {
        type: 'rating',
        options: { max: 5, icon: 'star', color: 'yellowBright' },
      },
    });

    // Assert: Values become 5 (max), 0, null
    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('rating');

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[fieldId]).toBe(5);
    expect(records.find((r) => r.id === r2.id)?.fields[fieldId]).toBe(0);
    expect(records.find((r) => r.id === r3.id)?.fields[fieldId]).toBeNull();

    // Cleanup
    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });
});
