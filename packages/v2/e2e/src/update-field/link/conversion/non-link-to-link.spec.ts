/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: non-link to/from link conversion', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  const extractSymmetricFieldId = (
    field: { options?: unknown } | undefined
  ): string | undefined => {
    const options = field?.options as Record<string, unknown> | undefined;
    return typeof options?.symmetricFieldId === 'string' ? options.symmetricFieldId : undefined;
  };

  it('converts singleLineText to two-way manyOne link and creates symmetric field on foreign table', async () => {
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('nl2l-host-mo'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'ToConvert' },
      ],
    });
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('nl2l-foreign-mo'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const foreignPrimaryFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id;
    const convertFieldId = hostTable.fields.find((f) => f.name === 'ToConvert')?.id;
    if (!foreignPrimaryFieldId || !convertFieldId) {
      throw new Error('Failed to resolve field IDs');
    }

    // Convert singleLineText -> manyOne link
    const updatedTable = await ctx.updateField({
      tableId: hostTable.id,
      fieldId: convertFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    // Verify the field is now a link
    const linkField = updatedTable.fields.find((f) => f.id === convertFieldId);
    expect(linkField?.type).toBe('link');

    const symmetricFieldId = extractSymmetricFieldId(linkField);
    expect(symmetricFieldId).toBeDefined();

    // Verify foreign table has the symmetric field
    const foreignRefreshed = await ctx.getTableById(foreignTable.id);
    const symmetricField = foreignRefreshed.fields.find((f) => f.id === symmetricFieldId);
    expect(symmetricField).toBeDefined();
    expect(symmetricField?.type).toBe('link');

    // Verify records can be created with link values
    const foreignRecord = await ctx.createRecord(foreignTable.id, {
      [foreignPrimaryFieldId]: 'Foreign Record',
    });
    const hostPrimaryFieldId = hostTable.fields.find((f) => f.isPrimary)?.id;
    if (!hostPrimaryFieldId) throw new Error('No primary field');

    const hostRecord = await ctx.createRecord(hostTable.id, {
      [hostPrimaryFieldId]: 'Host Record',
      [convertFieldId]: { id: foreignRecord.id },
    });

    await ctx.drainOutbox();

    const records = await ctx.listRecords(hostTable.id);
    const created = records.find((r) => r.id === hostRecord.id);
    expect(created?.fields[convertFieldId]).toEqual({
      id: foreignRecord.id,
      title: 'Foreign Record',
    });
  });

  it('converts singleLineText to two-way oneMany link and creates symmetric field on foreign table', async () => {
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('nl2l-host-om'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'ToConvert' },
      ],
    });
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('nl2l-foreign-om'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const foreignPrimaryFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id;
    const convertFieldId = hostTable.fields.find((f) => f.name === 'ToConvert')?.id;
    if (!foreignPrimaryFieldId || !convertFieldId) {
      throw new Error('Failed to resolve field IDs');
    }

    // Convert singleLineText -> oneMany link
    const updatedTable = await ctx.updateField({
      tableId: hostTable.id,
      fieldId: convertFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'oneMany',
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    const linkField = updatedTable.fields.find((f) => f.id === convertFieldId);
    expect(linkField?.type).toBe('link');

    const symmetricFieldId = extractSymmetricFieldId(linkField);
    expect(symmetricFieldId).toBeDefined();

    // Verify foreign table has the symmetric field
    const foreignRefreshed = await ctx.getTableById(foreignTable.id);
    const symmetricField = foreignRefreshed.fields.find((f) => f.id === symmetricFieldId);
    expect(symmetricField).toBeDefined();
    expect(symmetricField?.type).toBe('link');

    // Verify records can be linked
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary)?.id;
    if (!foreignPrimary) throw new Error('No foreign primary field');

    const foreignRecord = await ctx.createRecord(foreignTable.id, {
      [foreignPrimary]: 'Foreign Rec',
    });
    const hostPrimaryFieldId = hostTable.fields.find((f) => f.isPrimary)?.id;
    if (!hostPrimaryFieldId) throw new Error('No primary field');

    const hostRecord = await ctx.createRecord(hostTable.id, {
      [hostPrimaryFieldId]: 'Host Rec',
      [convertFieldId]: [{ id: foreignRecord.id }],
    });

    await ctx.drainOutbox();

    const records = await ctx.listRecords(hostTable.id);
    const created = records.find((r) => r.id === hostRecord.id);
    expect(created?.fields[convertFieldId]).toEqual([
      { id: foreignRecord.id, title: 'Foreign Rec' },
    ]);
  });

  it('converts two-way link back to singleLineText and removes symmetric field from foreign table', async () => {
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('l2nl-host'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('l2nl-foreign'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const foreignPrimaryFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id;
    if (!foreignPrimaryFieldId) throw new Error('No foreign primary field');

    // First, create a two-way link field
    const tableWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    const linkField = tableWithLink.fields.find((f) => f.name === 'Link');
    const symmetricFieldId = extractSymmetricFieldId(linkField);
    if (!linkField || !symmetricFieldId) {
      throw new Error('Failed to create link field');
    }

    // Verify symmetric field exists on foreign table
    const foreignBefore = await ctx.getTableById(foreignTable.id);
    expect(foreignBefore.fields.some((f) => f.id === symmetricFieldId)).toBe(true);

    // Convert link field back to singleLineText
    await ctx.updateField({
      tableId: hostTable.id,
      fieldId: linkField.id,
      field: {
        type: 'singleLineText',
      },
    });

    await ctx.drainOutbox();

    // Verify foreign table no longer has the symmetric field
    const foreignAfter = await ctx.getTableById(foreignTable.id);
    expect(foreignAfter.fields.some((f) => f.id === symmetricFieldId)).toBe(false);
  });

  it('converts singleLineText to one-way link without creating symmetric field', async () => {
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('nl2l-host-ow'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'ToConvert' },
      ],
    });
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('nl2l-foreign-ow'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const foreignPrimaryFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id;
    const convertFieldId = hostTable.fields.find((f) => f.name === 'ToConvert')?.id;
    if (!foreignPrimaryFieldId || !convertFieldId) {
      throw new Error('Failed to resolve field IDs');
    }

    // Convert singleLineText -> one-way link
    const updatedTable = await ctx.updateField({
      tableId: hostTable.id,
      fieldId: convertFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });

    const linkField = updatedTable.fields.find((f) => f.id === convertFieldId);
    expect(linkField?.type).toBe('link');

    // Verify no symmetric field ID in options (one-way)
    const symmetricFieldId = extractSymmetricFieldId(linkField);
    expect(symmetricFieldId).toBeUndefined();

    // Verify foreign table has NO symmetric field (only its primary field)
    const foreignRefreshed = await ctx.getTableById(foreignTable.id);
    const linkFields = foreignRefreshed.fields.filter((f) => f.type === 'link');
    expect(linkFields).toHaveLength(0);
  });
});
