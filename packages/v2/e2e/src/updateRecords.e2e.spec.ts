import { getRandomString } from '@teable/v2-core';
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

  /**
   * v1 reference: record.e2e-spec.ts:1431 — omitted fields in sparse explicit
   * batch updates must be preserved, not cleared or re-validated.
   */
  it('preserves omitted singleSelect values in sparse explicit batch updates', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Sparse Select',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { id: 'optOpen', name: 'Open', color: 'blue' },
              { id: 'optClosed', name: 'Closed', color: 'red' },
            ],
            preventAutoNewOptions: true,
          },
        },
        { type: 'singleLineText', name: 'Notes' },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';
    const statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';
    const notesFieldId = table.fields.find((f) => f.name === 'Notes')?.id ?? '';

    const alpha = await ctx.createRecord(table.id, {
      [titleFieldId]: 'Alpha',
      [statusFieldId]: 'Open',
    });
    const beta = await ctx.createRecord(table.id, {
      [titleFieldId]: 'Beta',
      [statusFieldId]: 'Open',
    });

    await ctx.updateRecords({
      tableId: table.id,
      records: [
        { id: alpha.id, fields: { [notesFieldId]: 'Touched' } },
        { id: beta.id, fields: { [statusFieldId]: 'Closed' } },
      ],
    });

    const records = await ctx.listRecords(table.id);
    const alphaAfter = records.find((r) => r.id === alpha.id);
    const betaAfter = records.find((r) => r.id === beta.id);
    expect(alphaAfter?.fields[statusFieldId]).toBe('Open');
    expect(alphaAfter?.fields[notesFieldId]).toBe('Touched');
    expect(betaAfter?.fields[statusFieldId]).toBe('Closed');
  });

  /**
   * v1 reference: record.e2e-spec.ts:244 — with preventAutoNewOptions, typecast
   * drops unknown option values instead of creating new choices.
   */
  it('drops unknown option values under typecast when preventAutoNewOptions is set', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Prevent Auto Options',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Single',
          options: {
            choices: [{ id: 'optRed', name: 'red', color: 'red' }],
            preventAutoNewOptions: true,
          },
        },
        {
          type: 'multipleSelect',
          name: 'Multi',
          options: {
            choices: [{ id: 'optRedM', name: 'red', color: 'red' }],
            preventAutoNewOptions: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const singleFieldId = table.fields.find((f) => f.name === 'Single')?.id ?? '';
    const multiFieldId = table.fields.find((f) => f.name === 'Multi')?.id ?? '';
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';

    const r1 = await ctx.createRecord(table.id, { [titleFieldId]: 'R1' });
    const r2 = await ctx.createRecord(table.id, { [titleFieldId]: 'R2' });

    const updated = await ctx.updateRecords({
      tableId: table.id,
      typecast: true,
      records: [
        { id: r1.id, fields: { [singleFieldId]: 'red' } },
        { id: r2.id, fields: { [singleFieldId]: 'blue' } },
      ],
    });
    const updatedById = new Map(updated.records.map((r) => [r.id, r]));
    expect(updatedById.get(r1.id)?.fields[singleFieldId]).toBe('red');
    // v1 contract: unknown option is dropped, no new option is created
    expect(updatedById.get(r2.id)?.fields[singleFieldId] == null).toBe(true);

    const updatedMulti = await ctx.updateRecords({
      tableId: table.id,
      typecast: true,
      records: [{ id: r1.id, fields: { [multiFieldId]: ['red', 'blue'] } }],
    });
    expect(updatedMulti.records[0]?.fields[multiFieldId]).toEqual(['red']);

    const refreshed = await ctx.getTableById(table.id);
    const choiceNames = (fieldId: string) =>
      (
        (refreshed.fields.find((f) => f.id === fieldId)?.options as {
          choices?: Array<{ name: string }>;
        }) ?? {}
      ).choices?.map((c) => c.name) ?? [];
    expect(choiceNames(singleFieldId)).toEqual(['red']);
    expect(choiceNames(multiFieldId)).toEqual(['red']);
  });

  /**
   * v1 reference: record.e2e-spec.ts:1225 — duplicate updates targeting the
   * same record in one batch are merged so the latest value wins.
   */
  it('merges duplicate basic field updates to the latest', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Duplicate Basic',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text' },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

    const record = await ctx.createRecord(table.id, { [titleFieldId]: 'Dup' });

    await ctx.updateRecords({
      tableId: table.id,
      records: [
        { id: record.id, fields: { [textFieldId]: 'v1' } },
        { id: record.id, fields: { [textFieldId]: 'v2' } },
      ],
    });

    const records = await ctx.listRecords(table.id);
    expect(records.find((r) => r.id === record.id)?.fields[textFieldId]).toBe('v2');
  });

  /**
   * v1 reference: record.e2e-spec.ts:1242 — duplicate link updates (manyOne)
   * for the same record are merged so the last link target wins.
   */
  it('merges duplicate link updates (manyOne) so the last wins', async () => {
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Duplicate Link Foreign',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const foreignNameFieldId = foreign.fields.find((f) => f.isPrimary)?.id ?? '';
    const targetA = await ctx.createRecord(foreign.id, { [foreignNameFieldId]: 'A' });
    const targetB = await ctx.createRecord(foreign.id, { [foreignNameFieldId]: 'B' });

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Duplicate Link Main',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreign.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const linkFieldId = table.fields.find((f) => f.name === 'Link')?.id ?? '';

    const record = await ctx.createRecord(table.id, { [titleFieldId]: 'Main' });

    await ctx.updateRecords({
      tableId: table.id,
      records: [
        { id: record.id, fields: { [linkFieldId]: { id: targetA.id } } },
        { id: record.id, fields: { [linkFieldId]: { id: targetB.id } } },
      ],
    });

    const records = await ctx.listRecords(table.id);
    expect(records.find((r) => r.id === record.id)?.fields[linkFieldId]).toMatchObject({
      id: targetB.id,
    });
  });

  /**
   * v1 reference: record.e2e-spec.ts:1268 — after merging duplicate updates,
   * dependent formulas compute from the latest value.
   */
  it('merges duplicate updates with formula: computed value reflects the latest', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Duplicate Formula',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text' },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

    const withFormula = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: { type: 'formula', name: 'Echo', options: { expression: `{${textFieldId}}` } },
    });
    const formulaFieldId = withFormula.fields.find((f) => f.name === 'Echo')?.id ?? '';

    const record = await ctx.createRecord(table.id, { [titleFieldId]: 'Dup Formula' });

    await ctx.updateRecords({
      tableId: table.id,
      records: [
        { id: record.id, fields: { [textFieldId]: 'first' } },
        { id: record.id, fields: { [textFieldId]: 'second' } },
      ],
    });

    const records = await ctx.listRecords(table.id);
    expect(records.find((r) => r.id === record.id)?.fields[formulaFieldId]).toBe('second');
  });

  /**
   * v1 reference: record.e2e-spec.ts:1289 — after merging duplicate link
   * updates, lookups reflect the latest link target.
   */
  it('merges duplicate updates with lookup: value reflects the latest link target', async () => {
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Duplicate Lookup Foreign',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const foreignNameFieldId = foreign.fields.find((f) => f.isPrimary)?.id ?? '';
    const targetA = await ctx.createRecord(foreign.id, { [foreignNameFieldId]: 'A' });
    const targetB = await ctx.createRecord(foreign.id, { [foreignNameFieldId]: 'B' });

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Duplicate Lookup Main',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreign.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const linkFieldId = table.fields.find((f) => f.name === 'Link')?.id ?? '';

    const withLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'lookup',
        name: 'Name Lookup',
        options: {
          linkFieldId,
          foreignTableId: foreign.id,
          lookupFieldId: foreignNameFieldId,
        },
      },
    });
    const lookupFieldId = withLookup.fields.find((f) => f.name === 'Name Lookup')?.id ?? '';

    const record = await ctx.createRecord(table.id, { [titleFieldId]: 'Main' });

    await ctx.updateRecords({
      tableId: table.id,
      records: [
        { id: record.id, fields: { [linkFieldId]: { id: targetA.id } } },
        { id: record.id, fields: { [linkFieldId]: { id: targetB.id } } },
      ],
    });

    const records = await ctx.listRecords(table.id);
    const lookupValue = records.find((r) => r.id === record.id)?.fields[lookupFieldId];
    // assert merge semantics without pinning the single/array lookup shape
    expect(Array.isArray(lookupValue) ? lookupValue : [lookupValue]).toEqual(['B']);
  });

  /**
   * v1 reference: record.e2e-spec.ts:1334 — after merging duplicate link-set
   * updates, rollups aggregate over the latest link set only.
   */
  it('merges duplicate updates with rollup: sum reflects the latest link set', async () => {
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Duplicate Rollup Foreign',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Value' },
      ],
      views: [{ type: 'grid' }],
    });
    const foreignNameFieldId = foreign.fields.find((f) => f.isPrimary)?.id ?? '';
    const foreignValueFieldId = foreign.fields.find((f) => f.name === 'Value')?.id ?? '';
    const targetA = await ctx.createRecord(foreign.id, {
      [foreignNameFieldId]: 'A',
      [foreignValueFieldId]: 10,
    });
    const targetB = await ctx.createRecord(foreign.id, {
      [foreignNameFieldId]: 'B',
      [foreignValueFieldId]: 7,
    });
    const targetC = await ctx.createRecord(foreign.id, {
      [foreignNameFieldId]: 'C',
      [foreignValueFieldId]: 5,
    });

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Duplicate Rollup Main',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          name: 'Links',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreign.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const linkFieldId = table.fields.find((f) => f.name === 'Links')?.id ?? '';

    const withRollup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'rollup',
        name: 'Sum',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId,
          foreignTableId: foreign.id,
          lookupFieldId: foreignValueFieldId,
        },
      },
    });
    const rollupFieldId = withRollup.fields.find((f) => f.name === 'Sum')?.id ?? '';

    const record = await ctx.createRecord(table.id, { [titleFieldId]: 'Main' });

    await ctx.updateRecords({
      tableId: table.id,
      records: [
        {
          id: record.id,
          fields: { [linkFieldId]: [{ id: targetA.id }, { id: targetB.id }] },
        },
        {
          id: record.id,
          fields: { [linkFieldId]: [{ id: targetC.id }] },
        },
      ],
    });

    const records = await ctx.listRecords(table.id);
    expect(records.find((r) => r.id === record.id)?.fields[rollupFieldId]).toBe(5);
  });

  /**
   * v1 reference: record.e2e-spec.ts:1489 — a required (notNull) singleSelect
   * must not fail validation for batch rows that omit the field.
   */
  it('does not fail required singleSelect validation when omitted in another batch row', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'UpdateRecords Required Select Sparse',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { id: 'optReqOpen', name: 'Open', color: 'blue' },
              { id: 'optReqClosed', name: 'Closed', color: 'red' },
            ],
            preventAutoNewOptions: true,
          },
        },
        { type: 'singleLineText', name: 'Notes' },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    const statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';
    const notesFieldId = table.fields.find((f) => f.name === 'Notes')?.id ?? '';

    const alpha = await ctx.createRecord(table.id, {
      [titleFieldId]: 'Alpha',
      [statusFieldId]: 'Open',
    });
    const beta = await ctx.createRecord(table.id, {
      [titleFieldId]: 'Beta',
      [statusFieldId]: 'Open',
    });

    await ctx.updateField({
      tableId: table.id,
      fieldId: statusFieldId,
      field: { notNull: true },
    });

    await ctx.updateRecords({
      tableId: table.id,
      records: [
        { id: alpha.id, fields: { [statusFieldId]: 'Closed' } },
        { id: beta.id, fields: { [notesFieldId]: 'Still open' } },
      ],
    });

    const records = await ctx.listRecords(table.id);
    const alphaAfter = records.find((r) => r.id === alpha.id);
    const betaAfter = records.find((r) => r.id === beta.id);
    expect(alphaAfter?.fields[statusFieldId]).toBe('Closed');
    expect(betaAfter?.fields[statusFieldId]).toBe('Open');
    expect(betaAfter?.fields[notesFieldId]).toBe('Still open');
  });

  /**
   * One explicit batch mixes scalar rows with rows the mutation-spec resolver
   * must rewrite (link titles, user identifiers). Reusing a row's already
   * materialized update must still answer with that row's own identity,
   * untouched cells and explicit nulls.
   */
  it('keeps scalar and resolver rows mapped to their own records in one batch', async () => {
    const suffix = getRandomString(8);
    const foreignTitleFieldId = `fld${getRandomString(16)}`;
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: `UpdateRecords Mixed Resolver Targets ${suffix}`,
      fields: [{ id: foreignTitleFieldId, type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const [targetA, targetB] = await ctx.createRecords(foreign.id, [
      { fields: { [foreignTitleFieldId]: 'Alpha target' } },
      { fields: { [foreignTitleFieldId]: 'Beta target' } },
    ]);
    if (!targetA || !targetB) throw new Error('Missing link targets');

    const linkFieldId = `fld${getRandomString(16)}`;
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `UpdateRecords Mixed Resolver Sources ${suffix}`,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'singleLineText', name: 'Notes' },
        {
          id: linkFieldId,
          type: 'link',
          name: 'Targets',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreign.id,
            lookupFieldId: foreignTitleFieldId,
            isOneWay: true,
          },
        },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    const amountFieldId = table.fields.find((field) => field.name === 'Amount')?.id ?? '';
    const notesFieldId = table.fields.find((field) => field.name === 'Notes')?.id ?? '';
    const ownerFieldId = table.fields.find((field) => field.name === 'Owner')?.id ?? '';

    const [rowA, rowB, rowC, rowD] = await ctx.createRecords(table.id, [
      {
        fields: {
          [titleFieldId]: 'Row A',
          [amountFieldId]: 1,
          [notesFieldId]: 'note-a',
          [linkFieldId]: [{ id: targetA.id }],
        },
      },
      {
        fields: {
          [titleFieldId]: 'Row B',
          [amountFieldId]: 2,
          [notesFieldId]: 'note-b',
          [linkFieldId]: [{ id: targetA.id }],
        },
      },
      {
        fields: {
          [titleFieldId]: 'Row C',
          [amountFieldId]: 3,
          [notesFieldId]: 'note-c',
          [linkFieldId]: [{ id: targetA.id }],
        },
      },
      {
        fields: {
          [titleFieldId]: 'Row D',
          [amountFieldId]: 4,
          [notesFieldId]: 'note-d',
          [linkFieldId]: [{ id: targetA.id }],
        },
      },
    ]);
    if (!rowA || !rowB || !rowC || !rowD) throw new Error('Missing source records');

    const result = await ctx.updateRecords({
      tableId: table.id,
      typecast: true,
      records: [
        // Scalar row: explicit null, plus omitted title/link/owner.
        { id: rowA.id, fields: { [amountFieldId]: 11, [notesFieldId]: null } },
        // Resolver row: link titles are replaced by resolved link ids.
        { id: rowB.id, fields: { [linkFieldId]: ['Beta target'] } },
        // Scalar row: omitted amount, title and link must survive.
        { id: rowC.id, fields: { [notesFieldId]: 'note-c-updated' } },
        // Resolver row: a user identifier expands into a full user cell.
        { id: rowD.id, fields: { [ownerFieldId]: ctx.testUser.email } },
      ],
    });

    expect(result.updatedCount).toBe(4);
    const returned = result.records ?? [];
    expect(returned.map((record) => record.id).sort()).toEqual(
      [rowA.id, rowB.id, rowC.id, rowD.id].sort()
    );
    const returnedById = new Map(returned.map((record) => [record.id, record]));
    const linkIds = (value: unknown): string[] => {
      if (!Array.isArray(value)) return [];
      const ids: string[] = [];
      for (const item of value) {
        if (typeof item === 'string') {
          ids.push(item);
        } else if (
          item &&
          typeof item === 'object' &&
          'id' in item &&
          typeof item.id === 'string'
        ) {
          ids.push(item.id);
        }
      }
      return ids;
    };

    const returnedA = returnedById.get(rowA.id);
    expect(returnedA?.fields[titleFieldId]).toBe('Row A');
    expect(returnedA?.fields[amountFieldId]).toBe(11);
    expect(returnedA?.fields[notesFieldId]).toBeNull();
    expect(linkIds(returnedA?.fields[linkFieldId])).toEqual([targetA.id]);
    expect(returnedA?.fields[ownerFieldId] ?? null).toBeNull();

    const returnedB = returnedById.get(rowB.id);
    expect(returnedB?.fields[titleFieldId]).toBe('Row B');
    expect(returnedB?.fields[amountFieldId]).toBe(2);
    expect(returnedB?.fields[notesFieldId]).toBe('note-b');
    expect(linkIds(returnedB?.fields[linkFieldId])).toEqual([targetB.id]);
    expect(returnedB?.fields[ownerFieldId] ?? null).toBeNull();

    const returnedC = returnedById.get(rowC.id);
    expect(returnedC?.fields[titleFieldId]).toBe('Row C');
    expect(returnedC?.fields[amountFieldId]).toBe(3);
    expect(returnedC?.fields[notesFieldId]).toBe('note-c-updated');
    expect(linkIds(returnedC?.fields[linkFieldId])).toEqual([targetA.id]);
    expect(returnedC?.fields[ownerFieldId] ?? null).toBeNull();

    const returnedD = returnedById.get(rowD.id);
    expect(returnedD?.fields[titleFieldId]).toBe('Row D');
    expect(returnedD?.fields[amountFieldId]).toBe(4);
    expect(returnedD?.fields[notesFieldId]).toBe('note-d');
    expect(linkIds(returnedD?.fields[linkFieldId])).toEqual([targetA.id]);
    expect(returnedD?.fields[ownerFieldId]).toMatchObject({
      id: ctx.testUser.id,
      title: ctx.testUser.name,
      email: ctx.testUser.email,
    });

    const storedById = new Map(
      (await ctx.listRecords(table.id)).map((record) => [record.id, record])
    );
    const storedA = storedById.get(rowA.id);
    expect(storedA?.fields[titleFieldId]).toBe('Row A');
    expect(storedA?.fields[amountFieldId]).toBe(11);
    expect(storedA?.fields[notesFieldId]).toBeNull();
    expect(storedA?.fields[linkFieldId]).toEqual([{ id: targetA.id, title: 'Alpha target' }]);
    expect(storedA?.fields[ownerFieldId] ?? null).toBeNull();

    const storedB = storedById.get(rowB.id);
    expect(storedB?.fields[titleFieldId]).toBe('Row B');
    expect(storedB?.fields[amountFieldId]).toBe(2);
    expect(storedB?.fields[notesFieldId]).toBe('note-b');
    expect(storedB?.fields[linkFieldId]).toEqual([{ id: targetB.id, title: 'Beta target' }]);
    expect(storedB?.fields[ownerFieldId] ?? null).toBeNull();

    const storedC = storedById.get(rowC.id);
    expect(storedC?.fields[titleFieldId]).toBe('Row C');
    expect(storedC?.fields[amountFieldId]).toBe(3);
    expect(storedC?.fields[notesFieldId]).toBe('note-c-updated');
    expect(storedC?.fields[linkFieldId]).toEqual([{ id: targetA.id, title: 'Alpha target' }]);
    expect(storedC?.fields[ownerFieldId] ?? null).toBeNull();

    const storedD = storedById.get(rowD.id);
    expect(storedD?.fields[titleFieldId]).toBe('Row D');
    expect(storedD?.fields[amountFieldId]).toBe(4);
    expect(storedD?.fields[notesFieldId]).toBe('note-d');
    expect(storedD?.fields[linkFieldId]).toEqual([{ id: targetA.id, title: 'Alpha target' }]);
    expect(storedD?.fields[ownerFieldId]).toMatchObject({
      id: ctx.testUser.id,
      title: ctx.testUser.name,
      email: ctx.testUser.email,
    });
  });

  /**
   * A resolver error in a later row must leave earlier scalar rows unwritten
   * and must not persist the select option those rows would have created.
   */
  it('leaves earlier rows and new select options untouched when a resolver row fails', async () => {
    const suffix = getRandomString(8);
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `UpdateRecords Resolver Failure ${suffix}`,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'singleSelect', name: 'Status', options: ['Open'] },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
      ],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id ?? '';
    const amountFieldId = table.fields.find((field) => field.name === 'Amount')?.id ?? '';
    const statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';
    const ownerFieldId = table.fields.find((field) => field.name === 'Owner')?.id ?? '';

    const [first, second] = await ctx.createRecords(table.id, [
      {
        fields: {
          [titleFieldId]: 'Row One',
          [amountFieldId]: 1,
          [statusFieldId]: 'Open',
        },
      },
      {
        fields: {
          [titleFieldId]: 'Row Two',
          [amountFieldId]: 2,
          [statusFieldId]: 'Open',
        },
      },
    ]);
    if (!first || !second) throw new Error('Missing records');

    await expect(
      ctx.updateRecords({
        tableId: table.id,
        typecast: true,
        records: [
          {
            id: first.id,
            fields: { [amountFieldId]: 50, [statusFieldId]: 'Failing Option' },
          },
          {
            id: second.id,
            fields: { [ownerFieldId]: { id: ctx.testUser.id, email: 'not-test@e2e.com' } },
          },
        ],
      })
    ).rejects.toThrow(/user_not_found/);

    const storedById = new Map(
      (await ctx.listRecords(table.id)).map((record) => [record.id, record])
    );
    const firstAfter = storedById.get(first.id);
    expect(firstAfter?.fields[amountFieldId]).toBe(1);
    expect(firstAfter?.fields[statusFieldId]).toBe('Open');
    expect(firstAfter?.fields[ownerFieldId] ?? null).toBeNull();

    const secondAfter = storedById.get(second.id);
    expect(secondAfter?.fields[amountFieldId]).toBe(2);
    expect(secondAfter?.fields[statusFieldId]).toBe('Open');
    expect(secondAfter?.fields[ownerFieldId] ?? null).toBeNull();

    const refreshed = await ctx.getTableById(table.id);
    const statusField = refreshed.fields.find((field) => field.id === statusFieldId);
    const choiceNames: string[] = [];
    const options = statusField?.options;
    if (
      options &&
      typeof options === 'object' &&
      'choices' in options &&
      Array.isArray(options.choices)
    ) {
      for (const choice of options.choices) {
        if (
          choice &&
          typeof choice === 'object' &&
          'name' in choice &&
          typeof choice.name === 'string'
        ) {
          choiceNames.push(choice.name);
        }
      }
    }
    expect(choiceNames).toEqual(['Open']);
  });
});
