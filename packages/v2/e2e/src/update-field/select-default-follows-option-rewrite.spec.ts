/**
 * T7820 / N-27 — option rewrite reconciles an unchanged select default.
 *
 * Y2561: renaming the option a single-select default names must save and follow
 * the new name. Deleting that option must save and clear the default.
 * Y2733: deleting one of a multi-select default's options drops only that name.
 * Y2734: deleting every default option clears defaultValue (not `[]`).
 *
 * A payload that already supplies the new defaultValue is left alone.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../shared/globalTestContext';

type Choice = { id: string; name: string; color?: string };

const fieldOptions = (field: { options?: unknown } | undefined) =>
  (field?.options as { choices?: Choice[]; defaultValue?: string | string[] | null } | undefined) ??
  {};

describe('T7820 select default follows option rewrite', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const reloadField = async (fieldId: string) => {
    const table = await ctx.getTableById(tableId);
    const field = table.fields.find((item) => item.id === fieldId);
    expect(field, `field ${fieldId} should exist`).toBeDefined();
    return field!;
  };

  const readCell = async (recordId: string, fieldId: string) => {
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    return rows.find((row) => row.id === recordId)?.fields[fieldId];
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7820 Select Default Follow',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    const primary = table.fields.find((field) => field.isPrimary);
    if (!primary) throw new Error('expected primary field');
    primaryFieldId = primary.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('Y2561 rename-only follows defaultValue to the new option name', async () => {
    const fieldId = createFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'S',
        options: {
          choices: [
            { name: 'Alpha', color: 'blue' },
            { name: 'Beta', color: 'green' },
          ],
          defaultValue: 'Alpha',
        },
      },
    });
    const createdField = created.fields.find((field) => field.id === fieldId);
    const [alpha, beta] = fieldOptions(createdField).choices ?? [];

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: {
        options: {
          choices: [{ id: alpha.id, name: 'Alpha 2', color: alpha.color }, beta],
        },
      },
    });

    const renamed = await reloadField(fieldId);
    expect(fieldOptions(renamed).defaultValue).toBe('Alpha 2');
    expect(fieldOptions(renamed).choices?.map((choice) => choice.name)).toEqual([
      'Alpha 2',
      'Beta',
    ]);

    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'n-rename' });
    expect(await readCell(record.id, fieldId)).toBe('Alpha 2');
  });

  test('Y2561 deleting the default option clears defaultValue', async () => {
    const fieldId = createFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'S-delete',
        options: {
          choices: [
            { name: 'Alpha', color: 'blue' },
            { name: 'Beta', color: 'green' },
          ],
          defaultValue: 'Alpha',
        },
      },
    });
    const createdField = created.fields.find((field) => field.id === fieldId);
    const [, beta] = fieldOptions(createdField).choices ?? [];

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [beta] } },
    });

    const deleted = await reloadField(fieldId);
    expect(fieldOptions(deleted).defaultValue).toBeUndefined();
    expect(fieldOptions(deleted).choices?.map((choice) => choice.name)).toEqual(['Beta']);

    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'n-delete' });
    expect((await readCell(record.id, fieldId)) == null).toBe(true);
  });

  test('Y2561 resending the stale defaultValue still follows a rename', async () => {
    const fieldId = createFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'S-stale',
        options: {
          choices: [
            { name: 'Alpha', color: 'blue' },
            { name: 'Beta', color: 'green' },
          ],
          defaultValue: 'Alpha',
        },
      },
    });
    const createdField = created.fields.find((field) => field.id === fieldId);
    const [alpha, beta] = fieldOptions(createdField).choices ?? [];

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: {
        options: {
          choices: [{ id: alpha.id, name: 'Alpha 2', color: alpha.color }, beta],
          defaultValue: 'Alpha',
        },
      },
    });

    const renamed = await reloadField(fieldId);
    expect(fieldOptions(renamed).defaultValue).toBe('Alpha 2');
  });

  test('Y2733 deleting one multi-select default option drops only that name', async () => {
    const fieldId = createFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Tags',
        options: {
          choices: [
            { name: 'A', color: 'blue' },
            { name: 'B', color: 'green' },
            { name: 'C', color: 'red' },
          ],
          defaultValue: ['A', 'B'],
        },
      },
    });
    const createdField = created.fields.find((field) => field.id === fieldId);
    const [, b, c] = fieldOptions(createdField).choices ?? [];

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [b, c] } },
    });

    const updated = await reloadField(fieldId);
    expect(fieldOptions(updated).defaultValue).toEqual(['B']);
    expect(fieldOptions(updated).choices?.map((choice) => choice.name)).toEqual(['B', 'C']);

    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'n1' });
    expect(await readCell(record.id, fieldId)).toEqual(['B']);
  });

  test('Y2734 deleting every multi-select default option clears defaultValue', async () => {
    const fieldId = createFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Tags-all',
        options: {
          choices: [
            { name: 'A', color: 'blue' },
            { name: 'B', color: 'green' },
            { name: 'C', color: 'red' },
          ],
          defaultValue: ['A', 'B'],
        },
      },
    });
    const createdField = created.fields.find((field) => field.id === fieldId);
    const [, , c] = fieldOptions(createdField).choices ?? [];

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [c] } },
    });

    const updated = await reloadField(fieldId);
    const options = fieldOptions(updated);
    expect(options.defaultValue == null).toBe(true);
    expect(options.defaultValue).not.toEqual([]);
    expect(options.choices?.map((choice) => choice.name)).toEqual(['C']);

    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'n1' });
    expect((await readCell(record.id, fieldId)) == null).toBe(true);
  });

  test('explicit new defaultValue still wins over rename and delete', async () => {
    const fieldId = createFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'S-explicit',
        options: {
          choices: [
            { name: 'Alpha', color: 'blue' },
            { name: 'Beta', color: 'green' },
            { name: 'Gamma', color: 'red' },
          ],
          defaultValue: 'Alpha',
        },
      },
    });
    const createdField = created.fields.find((field) => field.id === fieldId);
    const [alpha, beta] = fieldOptions(createdField).choices ?? [];

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: {
        options: {
          choices: [{ id: alpha.id, name: 'Alpha renamed', color: alpha.color }, beta],
          defaultValue: 'Alpha renamed',
        },
      },
    });
    expect(fieldOptions(await reloadField(fieldId)).defaultValue).toBe('Alpha renamed');

    const repointed = await reloadField(fieldId);
    const [, betaAfter] = fieldOptions(repointed).choices ?? [];
    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: { options: { choices: [betaAfter], defaultValue: 'Beta' } },
    });
    expect(fieldOptions(await reloadField(fieldId)).defaultValue).toBe('Beta');

    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'n-explicit' });
    expect(await readCell(record.id, fieldId)).toBe('Beta');
  });

  test('Y2733 rename-only follows each multi-select default name', async () => {
    const fieldId = createFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Tags-rename',
        options: {
          choices: [
            { name: 'A', color: 'blue' },
            { name: 'B', color: 'green' },
          ],
          defaultValue: ['A', 'B'],
        },
      },
    });
    const createdField = created.fields.find((field) => field.id === fieldId);
    const [a, b] = fieldOptions(createdField).choices ?? [];

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: {
        options: {
          choices: [{ id: a.id, name: 'A2', color: a.color }, b],
        },
      },
    });

    const updated = await reloadField(fieldId);
    expect(fieldOptions(updated).defaultValue).toEqual(['A2', 'B']);
    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'n-rename' });
    expect(await readCell(record.id, fieldId)).toEqual(['A2', 'B']);
  });

  test('explicit multi-select defaultValue wins over automatic rename follow', async () => {
    const fieldId = createFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Tags-explicit',
        options: {
          choices: [
            { name: 'A', color: 'blue' },
            { name: 'B', color: 'green' },
          ],
          defaultValue: ['A', 'B'],
        },
      },
    });
    const createdField = created.fields.find((field) => field.id === fieldId);
    const [a, b] = fieldOptions(createdField).choices ?? [];

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: {
        options: {
          choices: [{ id: a.id, name: 'A2', color: a.color }, b],
          defaultValue: ['B'],
        },
      },
    });

    expect(fieldOptions(await reloadField(fieldId)).defaultValue).toEqual(['B']);
    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'n-explicit-multi' });
    expect(await readCell(record.id, fieldId)).toEqual(['B']);
  });

  test('omitted choice ids keep the default attached to the same names', async () => {
    const fieldId = createFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'S omitted ids',
        options: {
          choices: [
            { name: 'Alpha', color: 'blue' },
            { name: 'Beta', color: 'green' },
          ],
          defaultValue: 'Alpha',
        },
      },
    });
    const createdField = created.fields.find((field) => field.id === fieldId);
    const [alpha, beta] = fieldOptions(createdField).choices ?? [];

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: {
        options: {
          choices: [
            { name: 'Alpha', color: 'red' },
            { name: 'Beta', color: beta.color },
          ],
        },
      },
    });

    const updated = await reloadField(fieldId);
    const options = fieldOptions(updated);
    expect(options.defaultValue).toBe('Alpha');
    expect(options.choices?.map((choice) => choice.id)).toEqual([alpha.id, beta.id]);
    expect(options.choices?.[0]?.color).toBe('red');
  });

  test('an explicit new choice id replaces the old id instead of being adopted', async () => {
    const fieldId = createFieldId();
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'S explicit id',
        options: {
          choices: [{ name: 'Alpha', color: 'blue' }],
          defaultValue: 'Alpha',
        },
      },
    });
    const createdField = created.fields.find((field) => field.id === fieldId);
    const previousId = fieldOptions(createdField).choices?.[0]?.id;
    expect(previousId).toBeTruthy();

    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: {
        options: {
          choices: [{ id: 'choNewAlpha', name: 'Alpha', color: 'green' }],
        },
      },
    });

    const updated = await reloadField(fieldId);
    const options = fieldOptions(updated);
    expect(options.choices?.map((choice) => choice.id)).toEqual(['choNewAlpha']);
    expect(options.choices?.[0]?.id).not.toBe(previousId);
    expect(options.defaultValue ?? null).toBeNull();

    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'explicit-id' });
    expect((await readCell(record.id, fieldId)) ?? null).toBeNull();
  });
});
