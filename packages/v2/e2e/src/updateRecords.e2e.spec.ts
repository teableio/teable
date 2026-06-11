import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http updateRecords (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const createFilterVariantTable = async (name: string) => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'singleLineText', name: 'Status' },
        { type: 'singleLineText', name: 'Notes' },
      ],
      views: [{ type: 'grid' }],
    });

    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    const amountFieldId = table.fields.find((field) => field.name === 'Amount')?.id ?? '';
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
    const notesFieldId = table.fields.find((field) => field.name === 'Notes')?.id ?? '';

    await ctx.createRecords(table.id, [
      {
        fields: {
          [titleFieldId]: 'Alpha',
          [amountFieldId]: 2,
          [statusFieldId]: 'Open',
          [notesFieldId]: '',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Beta',
          [amountFieldId]: 8,
          [statusFieldId]: 'Open',
          [notesFieldId]: 'needs-review',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Gamma',
          [amountFieldId]: 12,
          [statusFieldId]: 'Done',
          [notesFieldId]: 'ready',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Delta',
          [amountFieldId]: 5,
          [statusFieldId]: 'InProgress',
        },
      },
    ]);

    return {
      table,
      titleFieldId,
      amountFieldId,
      statusFieldId,
      notesFieldId,
    };
  };

  const getStatusByTitle = async (tableId: string, titleFieldId: string, statusFieldId: string) => {
    const records = await ctx.listRecords(tableId);
    return new Map(
      records.map((record) => [record.fields[titleFieldId], record.fields[statusFieldId]])
    );
  };

  it('updates all records matching the filter', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Update Records Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'singleLineText', name: 'Status' },
      ],
      views: [{ type: 'grid' }],
    });

    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    const amountFieldId = table.fields.find((field) => field.name === 'Amount')?.id ?? '';
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

    await ctx.createRecords(table.id, [
      {
        fields: {
          [titleFieldId]: 'Alpha',
          [amountFieldId]: 1,
          [statusFieldId]: 'Open',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Beta',
          [amountFieldId]: 8,
          [statusFieldId]: 'Open',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Gamma',
          [amountFieldId]: 12,
          [statusFieldId]: 'Open',
        },
      },
    ]);

    const result = await ctx.updateRecords({
      tableId: table.id,
      fields: {
        [statusFieldId]: 'Done',
      },
      filter: {
        fieldId: amountFieldId,
        operator: 'isGreater',
        value: 5,
      },
    });

    expect(result.updatedCount).toBe(2);

    const records = await ctx.listRecords(table.id);
    const statusByTitle = new Map(
      records.map((record) => [record.fields[titleFieldId], record.fields[statusFieldId]])
    );

    expect(statusByTitle.get('Alpha')).toBe('Open');
    expect(statusByTitle.get('Beta')).toBe('Done');
    expect(statusByTitle.get('Gamma')).toBe('Done');
  });

  it('updates records matching nested and/or filter groups', async () => {
    const { table, titleFieldId, amountFieldId, statusFieldId } = await createFilterVariantTable(
      'Update Records Nested Filter Table'
    );

    const result = await ctx.updateRecords({
      tableId: table.id,
      fields: {
        [statusFieldId]: 'Escalated',
      },
      filter: {
        conjunction: 'or',
        items: [
          {
            fieldId: statusFieldId,
            operator: 'is',
            value: 'InProgress',
          },
          {
            conjunction: 'and',
            items: [
              {
                fieldId: amountFieldId,
                operator: 'isGreater',
                value: 10,
              },
              {
                fieldId: titleFieldId,
                operator: 'contains',
                value: 'mm',
              },
            ],
          },
        ],
      },
    });

    expect(result.updatedCount).toBe(2);

    const statusByTitle = await getStatusByTitle(table.id, titleFieldId, statusFieldId);

    expect(statusByTitle.get('Alpha')).toBe('Open');
    expect(statusByTitle.get('Beta')).toBe('Open');
    expect(statusByTitle.get('Gamma')).toBe('Escalated');
    expect(statusByTitle.get('Delta')).toBe('Escalated');
  });

  it('updates records matching negated filters', async () => {
    const { table, titleFieldId, statusFieldId } = await createFilterVariantTable(
      'Update Records Not Filter Table'
    );

    const result = await ctx.updateRecords({
      tableId: table.id,
      fields: {
        [statusFieldId]: 'Queued',
      },
      filter: {
        not: {
          fieldId: statusFieldId,
          operator: 'is',
          value: 'Done',
        },
      },
    });

    expect(result.updatedCount).toBe(3);

    const statusByTitle = await getStatusByTitle(table.id, titleFieldId, statusFieldId);

    expect(statusByTitle.get('Alpha')).toBe('Queued');
    expect(statusByTitle.get('Beta')).toBe('Queued');
    expect(statusByTitle.get('Gamma')).toBe('Done');
    expect(statusByTitle.get('Delta')).toBe('Queued');
  });

  it('updates records matching unary isEmpty filters without explicit values', async () => {
    const { table, titleFieldId, statusFieldId, notesFieldId } = await createFilterVariantTable(
      'Update Records Unary Filter Table'
    );

    const result = await ctx.updateRecords({
      tableId: table.id,
      fields: {
        [statusFieldId]: 'NeedsNotes',
      },
      filter: {
        fieldId: notesFieldId,
        operator: 'isEmpty',
      },
    });

    expect(result.updatedCount).toBe(2);

    const statusByTitle = await getStatusByTitle(table.id, titleFieldId, statusFieldId);

    expect(statusByTitle.get('Alpha')).toBe('NeedsNotes');
    expect(statusByTitle.get('Beta')).toBe('Open');
    expect(statusByTitle.get('Gamma')).toBe('Done');
    expect(statusByTitle.get('Delta')).toBe('NeedsNotes');
  });

  it('updates explicit recordIds', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Update Records By Ids Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Status' },
      ],
      views: [{ type: 'grid' }],
    });

    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

    const [recordA, recordB, recordC] = await ctx.createRecords(table.id, [
      {
        fields: {
          [titleFieldId]: 'Alpha',
          [statusFieldId]: 'Open',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Beta',
          [statusFieldId]: 'Open',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Gamma',
          [statusFieldId]: 'Open',
        },
      },
    ]);

    const result = await ctx.updateRecords({
      tableId: table.id,
      fields: {
        [statusFieldId]: 'Done',
      },
      recordIds: [recordA.id, recordC.id],
    });

    expect(result.updatedCount).toBe(2);

    const records = await ctx.listRecords(table.id);
    const statusByTitle = new Map(
      records.map((record) => [record.fields[titleFieldId], record.fields[statusFieldId]])
    );

    expect(statusByTitle.get('Alpha')).toBe('Done');
    expect(statusByTitle.get('Beta')).toBe('Open');
    expect(statusByTitle.get('Gamma')).toBe('Done');
    expect(recordB?.id).toBeDefined();
  });

  it('does not create select options when no record matches the filter', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Update Records No Match Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: ['Open'],
        },
      ],
      views: [{ type: 'grid' }],
    });

    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

    await ctx.createRecord(table.id, {
      [titleFieldId]: 'Keep',
      [statusFieldId]: 'Open',
    });

    const result = await ctx.updateRecords({
      tableId: table.id,
      typecast: true,
      fields: {
        [statusFieldId]: 'Closed',
      },
      filter: {
        fieldId: titleFieldId,
        operator: 'is',
        value: 'Missing',
      },
    });

    expect(result.updatedCount).toBe(0);

    const refreshed = await ctx.getTableById(table.id);
    const statusField = refreshed.fields.find((field) => field.id === statusFieldId);
    const choices =
      (statusField?.options as { choices?: Array<{ name: string }> } | undefined)?.choices ?? [];

    expect(choices.map((choice) => choice.name)).toEqual(['Open']);
  });

  it('rejects empty filters instead of updating every record', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Update Records Empty Filter Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Status' },
      ],
      views: [{ type: 'grid' }],
    });

    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

    await ctx.createRecords(table.id, [
      {
        fields: {
          [titleFieldId]: 'Alpha',
          [statusFieldId]: 'Open',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Beta',
          [statusFieldId]: 'Open',
        },
      },
    ]);

    const response = await fetch(`${ctx.baseUrl}/tables/updateRecords`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tableId: table.id,
        fields: {
          [statusFieldId]: 'Done',
        },
        filter: {
          conjunction: 'and',
          items: [],
        },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid request',
      },
    });

    const records = await ctx.listRecords(table.id);
    const statusByTitle = new Map(
      records.map((record) => [record.fields[titleFieldId], record.fields[statusFieldId]])
    );

    expect(statusByTitle.get('Alpha')).toBe('Open');
    expect(statusByTitle.get('Beta')).toBe('Open');
  });
});
