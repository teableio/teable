import { FieldKeyType } from '@teable/v2-core';
import { describe, beforeAll, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 formula lookup empty text IF (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('evaluates IF with lookup array and empty text branch', async () => {
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'lookup-if-foreign',
      fields: [{ type: 'singleLineText', name: 'Title' }],
      views: [{ type: 'grid' }],
    });
    const foreignRecord = await ctx.createRecord(foreign.id, { Title: 'Item A' });

    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'lookup-if-host',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'checkbox', name: 'Active' },
        { type: 'singleLineText', name: 'Empty Text' },
      ],
      views: [{ type: 'grid' }],
    });
    const recordA = await ctx.createRecord(host.id, {
      Name: 'Row 1',
      Active: true,
      'Empty Text': '',
    });
    const recordB = await ctx.createRecord(host.id, {
      Name: 'Row 2',
      Active: false,
      'Empty Text': '',
    });

    const titleFieldId = foreign.fields.find((field) => field.name === 'Title')?.id;
    const activeFieldId = host.fields.find((field) => field.name === 'Active')?.id;
    const emptyTextFieldId = host.fields.find((field) => field.name === 'Empty Text')?.id;
    if (!titleFieldId || !activeFieldId || !emptyTextFieldId) {
      throw new Error('Failed to resolve field IDs');
    }

    const linkTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: host.id,
      field: {
        name: 'Link',
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreign.id,
          lookupFieldId: titleFieldId,
        },
      },
    });
    const linkField = linkTable.fields.find((f) => f.name === 'Link');
    if (!linkField) throw new Error('Failed to find Link field');

    // Update record to link to foreign record using fieldKeyType: id
    const updateResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: host.id,
        recordId: recordA.id,
        fields: { [linkField.id]: { id: foreignRecord.id } },
        fieldKeyType: FieldKeyType.Id,
      }),
    });
    if (!updateResponse.ok) {
      throw new Error(`Failed to update record: ${await updateResponse.text()}`);
    }

    const lookupTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: host.id,
      field: {
        name: 'Lookup Title',
        type: 'lookup',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: titleFieldId,
          linkFieldId: linkField.id,
        },
      },
    });
    const lookupField = lookupTable.fields.find((f) => f.name === 'Lookup Title');
    if (!lookupField) throw new Error('Failed to find Lookup Title field');

    const formulaTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: host.id,
      field: {
        name: 'Lookup If Empty',
        type: 'formula',
        options: {
          expression: `IF({${activeFieldId}}, {${lookupField.id}}, {${emptyTextFieldId}})`,
        },
      },
    });
    const formulaField = formulaTable.fields.find((f) => f.name === 'Lookup If Empty');
    if (!formulaField) throw new Error('Failed to find Lookup If Empty field');

    await ctx.drainOutbox();

    // List records with fieldKeyType: id
    const params = new URLSearchParams({ tableId: host.id, fieldKeyType: FieldKeyType.Id });
    const listResponse = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
    });
    if (!listResponse.ok) {
      throw new Error(`Failed to list records: ${await listResponse.text()}`);
    }
    const listBody = (await listResponse.json()) as {
      data: { records: Array<{ id: string; fields: Record<string, unknown> }> };
    };
    const records = listBody.data.records;

    const hostA = records.find((record: { id: string }) => record.id === recordA.id);
    const hostB = records.find((record: { id: string }) => record.id === recordB.id);
    expect(hostA?.fields[formulaField.id]).toBe('Item A');
    expect(hostB?.fields[formulaField.id]).toBeNull();
  });
});
