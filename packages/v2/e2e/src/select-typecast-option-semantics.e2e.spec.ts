import { createRecordOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const quotedCommaValue = '"A, B", C';
const denyAutoCreateHeader = 'x-teable-allow-select-option-auto-create';

type Choice = { id?: string; name: string };

const choiceNames = (field: { options?: unknown } | undefined): string[] =>
  ((field?.options as { choices?: Choice[] } | undefined)?.choices ?? []).map(
    (choice) => choice.name
  );

const choiceIdByName = (field: { options?: unknown } | undefined, name: string): string => {
  const choice = ((field?.options as { choices?: Choice[] } | undefined)?.choices ?? []).find(
    (item) => item.name === name
  );
  if (!choice?.id) {
    throw new Error(`Missing choice id for ${name}`);
  }
  return choice.id;
};

describe('select typecast option semantics T7822 T7823 T7826 T7827', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('T7823 Y2731 typecast keeps a quoted comma as one multipleSelect choice', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7823 quoted comma typecast',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'multipleSelect',
          name: 'Tags',
          options: { choices: [] },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const tagsFieldId = table.fields.find((field) => field.name === 'Tags')?.id ?? '';

    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        typecast: true,
        fields: { [tagsFieldId]: quotedCommaValue },
      }),
    });

    expect(response.status).toBe(201);
    const parsed = createRecordOkResponseSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;
    expect(parsed.data.data.record.fields[tagsFieldId]).toEqual(['A, B', 'C']);

    const updated = await ctx.getTableById(table.id);
    expect(choiceNames(updated.fields.find((field) => field.id === tagsFieldId)).sort()).toEqual([
      'A, B',
      'C',
    ]);
  });

  it('T7823 Y2731 field conversion keeps a quoted comma as one multipleSelect choice', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7823 quoted comma conversion',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Tags' },
      ],
      views: [{ type: 'grid' }],
    });
    const tagsFieldId = table.fields.find((field) => field.name === 'Tags')?.id ?? '';
    const record = await ctx.createRecord(table.id, { [tagsFieldId]: quotedCommaValue });

    await ctx.updateField({
      tableId: table.id,
      fieldId: tagsFieldId,
      field: { type: 'multipleSelect' },
    });

    const records = await ctx.listRecords(table.id);
    expect(records.find((item) => item.id === record.id)?.fields[tagsFieldId]).toEqual([
      'A, B',
      'C',
    ]);
    const updated = await ctx.getTableById(table.id);
    expect(choiceNames(updated.fields.find((field) => field.id === tagsFieldId)).sort()).toEqual([
      'A, B',
      'C',
    ]);
  });

  it('T7826 Y2727 rejects a choice id without typecast and leaves the cell empty', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7826 choice id without typecast',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { name: 'A', color: 'blue' },
              { name: 'B', color: 'green' },
            ],
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const statusField = table.fields.find((field) => field.name === 'Status');
    const statusFieldId = statusField?.id ?? '';
    const choiceAId = choiceIdByName(statusField, 'A');
    const record = await ctx.createRecord(table.id, {});

    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        recordId: record.id,
        fields: { [statusFieldId]: choiceAId },
      }),
    });

    expect(response.status).toBe(400);
    const records = await ctx.listRecords(table.id);
    expect(records.find((item) => item.id === record.id)?.fields[statusFieldId] ?? null).toBeNull();
    const updated = await ctx.getTableById(table.id);
    expect(choiceNames(updated.fields.find((field) => field.id === statusFieldId))).toEqual([
      'A',
      'B',
    ]);
  });

  it('T7826 Y2728 typecast treats a choice id as a new choice name', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7826 choice id with typecast',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { name: 'A', color: 'blue' },
              { name: 'B', color: 'green' },
            ],
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const statusField = table.fields.find((field) => field.name === 'Status');
    const statusFieldId = statusField?.id ?? '';
    const choiceAId = choiceIdByName(statusField, 'A');
    const record = await ctx.createRecord(table.id, {});

    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        recordId: record.id,
        typecast: true,
        fields: { [statusFieldId]: choiceAId },
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok?: boolean;
      data?: { record?: { fields?: Record<string, unknown> } };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.record?.fields?.[statusFieldId]).toBe(choiceAId);

    const records = await ctx.listRecords(table.id);
    expect(records.find((item) => item.id === record.id)?.fields[statusFieldId]).toBe(choiceAId);
    const updated = await ctx.getTableById(table.id);
    expect(choiceNames(updated.fields.find((field) => field.id === statusFieldId))).toEqual([
      'A',
      'B',
      choiceAId,
    ]);
  });

  it('T7822 Y2730 paste does not create a choice without field update permission', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7822 paste choice permission',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { name: 'A', color: 'blue' },
              { name: 'B', color: 'green' },
            ],
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
    const record = await ctx.createRecord(table.id, { [titleFieldId]: 'X' });

    const response = await fetch(`${ctx.baseUrl}/tables/paste`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [denyAutoCreateHeader]: 'false',
      },
      body: JSON.stringify({
        tableId: table.id,
        viewId: table.views[0]?.id,
        ranges: [
          [1, 0],
          [1, 0],
        ],
        content: [['X']],
        typecast: true,
      }),
    });

    expect(response.status).toBe(403);
    const records = await ctx.listRecords(table.id);
    expect(records.find((item) => item.id === record.id)?.fields[statusFieldId] ?? null).not.toBe(
      'X'
    );
    const updated = await ctx.getTableById(table.id);
    expect(choiceNames(updated.fields.find((field) => field.id === statusFieldId))).toEqual([
      'A',
      'B',
    ]);
  });

  it('T7827 Y2729 typecast does not create a choice without field update permission', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7827 typecast choice permission',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { name: 'A', color: 'blue' },
              { name: 'B', color: 'green' },
            ],
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
    const record = await ctx.createRecord(table.id, {});

    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [denyAutoCreateHeader]: 'false',
      },
      body: JSON.stringify({
        tableId: table.id,
        recordId: record.id,
        typecast: true,
        fields: { [statusFieldId]: 'X' },
      }),
    });

    expect(response.status).toBe(403);
    const records = await ctx.listRecords(table.id);
    expect(records.find((item) => item.id === record.id)?.fields[statusFieldId] ?? null).toBeNull();
    const updated = await ctx.getTableById(table.id);
    expect(choiceNames(updated.fields.find((field) => field.id === statusFieldId))).toEqual([
      'A',
      'B',
    ]);
  });

  it('still creates a choice when field update permission allows typecast', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7827 owner typecast choice',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { name: 'A', color: 'blue' },
              { name: 'B', color: 'green' },
            ],
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
    const record = await ctx.createRecord(table.id, {});

    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        recordId: record.id,
        typecast: true,
        fields: { [statusFieldId]: 'X' },
      }),
    });

    expect(response.status).toBe(200);
    const records = await ctx.listRecords(table.id);
    expect(records.find((item) => item.id === record.id)?.fields[statusFieldId]).toBe('X');
    const updated = await ctx.getTableById(table.id);
    expect(choiceNames(updated.fields.find((field) => field.id === statusFieldId))).toEqual([
      'A',
      'B',
      'X',
    ]);
  });
});
