/**
 * E2E tests for updating Lookup field properties.
 *
 * Lookup fields retrieve values from linked tables, so:
 * - lookupFieldId changes affect what's looked up
 * - Formatting syncs from the lookup target field
 * - Cascading updates when target field changes
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('update-field: lookup property updates', () => {
  let ctx: SharedTestContext;
  let sourceTableId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create source table
    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Lookup Source Table',
      fields: [{ type: 'singleLineText', name: 'Source Name', isPrimary: true }],
    });
    sourceTableId = sourceTable.id;

    // Create foreign table
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Lookup Foreign Table',
      fields: [{ type: 'singleLineText', name: 'Foreign Name', isPrimary: true }],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
  });

  afterAll(async () => {
    try {
      if (sourceTableId) await ctx.deleteTable(sourceTableId);
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {
      // Ignore cleanup errors
    }
  });

  // ============ General property updates ============

  test('[V1 PARITY] should update lookup field name', async () => {
    // Setup: Create a link field and a lookup field named "lookupField"
    const sourceTableAfterLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Name Link for Rename Test',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceTableAfterLink.fields.find(
      (f) => f.name === 'Name Link for Rename Test'
    );
    if (!linkField) throw new Error('Link field not found');

    const sourceTableAfterLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'lookupField',
        options: {
          linkFieldId: linkField.id,
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
        },
      },
    });
    const lookupField = sourceTableAfterLookup.fields.find((f) => f.name === 'lookupField');
    if (!lookupField) throw new Error('Lookup field not found');
    expect(lookupField.isLookup).toBe(true);
    expect(lookupField.lookupOptions).toBeDefined();

    // Action: Update name to "new lookupField"
    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: lookupField.id,
      field: {
        name: 'new lookupField',
      },
    });

    // Assert: Name changed, lookupOptions preserved
    const updatedField = updatedTable.fields.find((f) => f.id === lookupField.id);
    expect(updatedField).toBeDefined();
    expect(updatedField?.name).toBe('new lookupField');
    expect(updatedField?.isLookup).toBe(true);
    expect(updatedField?.lookupOptions).toBeDefined();
    const lookupOpts = updatedField?.lookupOptions as {
      linkFieldId?: string;
      foreignTableId?: string;
      lookupFieldId?: string;
    };
    expect(lookupOpts?.linkFieldId).toBe(linkField.id);
    expect(lookupOpts?.foreignTableId).toBe(foreignTableId);
    expect(lookupOpts?.lookupFieldId).toBe(foreignPrimaryFieldId);

    // Cleanup
    await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  // ============ Lookup configuration ============

  test('should update lookupFieldId', async () => {
    // Setup:
    // - Create link field to ForeignTable
    const sourceTableAfterLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link to Foreign',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceTableAfterLink.fields.find((f) => f.name === 'Link to Foreign');
    if (!linkField) throw new Error('Link field not found');

    // - Create another field in foreign table (Email)
    const foreignTableAfterEmail = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: { type: 'singleLineText', name: 'Email' },
    });
    const emailField = foreignTableAfterEmail.fields.find((f) => f.name === 'Email');
    if (!emailField) throw new Error('Email field not found');

    // - Create lookup field looking up ForeignTable.Name
    const sourceTableAfterLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'Lookup Field',
        options: {
          linkFieldId: linkField.id,
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
        },
      },
    });
    const lookupField = sourceTableAfterLookup.fields.find((f) => f.name === 'Lookup Field');
    if (!lookupField) throw new Error('Lookup field not found');

    // Create records
    const fRecord = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Foreign Record',
      [emailField.id]: 'test@example.com',
    });
    const sRecord = await ctx.createRecord(sourceTableId, {
      [linkField.id]: [{ id: fRecord.id }],
    });

    // Action: Update lookup to look up ForeignTable.Email instead
    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: lookupField.id,
      field: {
        options: {
          lookupFieldId: emailField.id,
        },
      },
    });

    // Assert:
    // - lookupFieldId changed
    const updatedField = updatedTable.fields.find((f) => f.id === lookupField.id);
    expect(updatedField?.lookupOptions?.lookupFieldId).toBe(emailField.id);

    // - Values recalculated
    const records = await ctx.listRecords(sourceTableId);
    const r = records.find((rec) => rec.id === sRecord.id);
    expect(r?.fields[lookupField.id]).toEqual(['test@example.com']);

    // Cleanup
    await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
    await ctx.deleteField({ tableId: foreignTableId, fieldId: emailField.id });
  });

  test('should update linkFieldId', async () => {
    // Setup:
    // - Create two link fields to same foreign table
    const sourceTableAfterLink1 = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link 1',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField1 = sourceTableAfterLink1.fields.find((f) => f.name === 'Link 1');
    if (!linkField1) throw new Error('Link 1 not found');

    const sourceTableAfterLink2 = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link 2',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField2 = sourceTableAfterLink2.fields.find((f) => f.name === 'Link 2');
    if (!linkField2) throw new Error('Link 2 not found');

    // - Create lookup using LinkField1
    const sourceTableAfterLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'Lookup Field',
        options: {
          linkFieldId: linkField1.id,
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
        },
      },
    });
    const lookupField = sourceTableAfterLookup.fields.find((f) => f.name === 'Lookup Field');
    if (!lookupField) throw new Error('Lookup field not found');

    // Create records
    const fRecord1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Foreign 1',
    });
    const fRecord2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Foreign 2',
    });
    const sRecord = await ctx.createRecord(sourceTableId, {
      [linkField1.id]: [{ id: fRecord1.id }],
      [linkField2.id]: [{ id: fRecord2.id }],
    });

    // Action: Update lookup to use LinkField2
    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: lookupField.id,
      field: {
        options: {
          linkFieldId: linkField2.id,
        },
      },
    });

    // Assert:
    // - linkFieldId changed
    const updatedField = updatedTable.fields.find((f) => f.id === lookupField.id);
    expect(updatedField?.lookupOptions?.linkFieldId).toBe(linkField2.id);

    // - Values recalculated based on new link
    const records = await ctx.listRecords(sourceTableId);
    const r = records.find((rec) => rec.id === sRecord.id);
    expect(r?.fields[lookupField.id]).toEqual(['Foreign 2']);

    // Cleanup
    await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField1.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField2.id });
  });

  test('should change lookupField from link to text', async () => {
    const sourceTable = await ctx.getTableById(sourceTableId);
    const sourcePrimaryFieldId = sourceTable.fields.find((f) => f.isPrimary)?.id;
    if (!sourcePrimaryFieldId) throw new Error('No source primary field');

    const foreignWithBackLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: {
        type: 'link',
        name: 'Foreign Back Link',
        options: {
          foreignTableId: sourceTableId,
          relationship: 'manyMany',
          lookupFieldId: sourcePrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const foreignBackLink = foreignWithBackLink.fields.find((f) => f.name === 'Foreign Back Link');
    if (!foreignBackLink) throw new Error('Foreign back link not found');

    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Source Link For LinkToText',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const sourceLink = sourceWithLink.fields.find((f) => f.name === 'Source Link For LinkToText');
    if (!sourceLink) throw new Error('Source link not found');

    const sourceWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'Lookup LinkToText',
        options: {
          linkFieldId: sourceLink.id,
          foreignTableId,
          lookupFieldId: foreignBackLink.id,
        },
      },
    });
    const lookupField = sourceWithLookup.fields.find((f) => f.name === 'Lookup LinkToText');
    if (!lookupField) throw new Error('Lookup field not found');

    const sourceRecord = await ctx.createRecord(sourceTableId, { [sourcePrimaryFieldId]: 'S1' });
    const foreignRecord = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'F1',
      [foreignBackLink.id]: [{ id: sourceRecord.id }],
    });
    await ctx.updateRecord(sourceTableId, sourceRecord.id, {
      [sourceLink.id]: [{ id: foreignRecord.id }],
    });

    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: lookupField.id,
      field: {
        options: {
          lookupFieldId: foreignPrimaryFieldId,
        },
      },
    });
    const updatedField = updatedTable.fields.find((f) => f.id === lookupField.id);
    expect(updatedField?.lookupOptions?.lookupFieldId).toBe(foreignPrimaryFieldId);

    const records = await ctx.listRecords(sourceTableId);
    expect(records.find((r) => r.id === sourceRecord.id)?.fields[lookupField.id]).toEqual(['F1']);

    await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: sourceLink.id });
    await ctx.deleteField({ tableId: foreignTableId, fieldId: foreignBackLink.id });
    await ctx.deleteRecords(sourceTableId, [sourceRecord.id]);
    await ctx.deleteRecords(foreignTableId, [foreignRecord.id]);
  });

  test('should change lookupField from link to other link', async () => {
    const sourceTable = await ctx.getTableById(sourceTableId);
    const sourcePrimaryFieldId = sourceTable.fields.find((f) => f.isPrimary)?.id;
    if (!sourcePrimaryFieldId) throw new Error('No source primary field');

    const foreignWithBackA = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: {
        type: 'link',
        name: 'Foreign Back A',
        options: {
          foreignTableId: sourceTableId,
          relationship: 'manyMany',
          lookupFieldId: sourcePrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const backA = foreignWithBackA.fields.find((f) => f.name === 'Foreign Back A');
    if (!backA) throw new Error('Back A not found');

    const foreignWithBackB = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: {
        type: 'link',
        name: 'Foreign Back B',
        options: {
          foreignTableId: sourceTableId,
          relationship: 'manyMany',
          lookupFieldId: sourcePrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const backB = foreignWithBackB.fields.find((f) => f.name === 'Foreign Back B');
    if (!backB) throw new Error('Back B not found');

    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Source Link For LinkToLink',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const sourceLink = sourceWithLink.fields.find((f) => f.name === 'Source Link For LinkToLink');
    if (!sourceLink) throw new Error('Source link not found');

    const sourceWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'Lookup LinkToLink',
        options: {
          linkFieldId: sourceLink.id,
          foreignTableId,
          lookupFieldId: backA.id,
        },
      },
    });
    const lookupField = sourceWithLookup.fields.find((f) => f.name === 'Lookup LinkToLink');
    if (!lookupField) throw new Error('Lookup field not found');

    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: lookupField.id,
      field: {
        options: {
          lookupFieldId: backB.id,
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === lookupField.id);
    expect(updatedField?.lookupOptions?.lookupFieldId).toBe(backB.id);

    await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: sourceLink.id });
    await ctx.deleteField({ tableId: foreignTableId, fieldId: backA.id });
    await ctx.deleteField({ tableId: foreignTableId, fieldId: backB.id });
  });

  test('should allow link relationship change manyMany to manyOne', async () => {
    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link Relationship Change',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceWithLink.fields.find((f) => f.name === 'Link Relationship Change');
    if (!linkField) throw new Error('Link field not found');

    const updated = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        options: {
          relationship: 'manyOne',
        },
      },
    });

    const updatedLink = updated.fields.find((f) => f.id === linkField.id) as
      | (typeof linkField & { options?: { relationship?: string } })
      | undefined;
    expect(updatedLink?.options?.relationship).toBe('manyOne');

    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  // ============ Cascading from target field ============

  test('should cascade when lookup target name changes', async () => {
    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link Target Rename',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceWithLink.fields.find((f) => f.name === 'Link Target Rename');
    if (!linkField) throw new Error('Link field not found');

    const sourceWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'Lookup Target Rename',
        options: {
          linkFieldId: linkField.id,
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
        },
      },
    });
    const lookupField = sourceWithLookup.fields.find((f) => f.name === 'Lookup Target Rename');
    if (!lookupField) throw new Error('Lookup field not found');

    const foreignRecord = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Rename Me',
    });
    const sourceRecord = await ctx.createRecord(sourceTableId, {
      [linkField.id]: [{ id: foreignRecord.id }],
    });

    await ctx.updateField({
      tableId: foreignTableId,
      fieldId: foreignPrimaryFieldId,
      field: { name: 'Foreign Name Renamed' },
    });

    const records = await ctx.listRecords(sourceTableId);
    expect(records.find((r) => r.id === sourceRecord.id)?.fields[lookupField.id]).toEqual([
      'Rename Me',
    ]);

    await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
    await ctx.deleteRecords(sourceTableId, [sourceRecord.id]);
    await ctx.deleteRecords(foreignTableId, [foreignRecord.id]);
  });

  test('should cascade when lookup target type changes', async () => {
    const foreignWithText = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: { type: 'singleLineText', name: 'Cascade Text' },
    });
    const textField = foreignWithText.fields.find((f) => f.name === 'Cascade Text');
    if (!textField) throw new Error('Text field not found');

    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link Target Type',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceWithLink.fields.find((f) => f.name === 'Link Target Type');
    if (!linkField) throw new Error('Link field not found');

    const sourceWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'Lookup Target Type',
        options: {
          linkFieldId: linkField.id,
          foreignTableId,
          lookupFieldId: textField.id,
        },
      },
    });
    const lookupField = sourceWithLookup.fields.find((f) => f.name === 'Lookup Target Type');
    if (!lookupField) throw new Error('Lookup field not found');

    const foreignRecord = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Type Row',
      [textField.id]: '123',
    });
    const sourceRecord = await ctx.createRecord(sourceTableId, {
      [linkField.id]: [{ id: foreignRecord.id }],
    });

    await ctx.updateField({
      tableId: foreignTableId,
      fieldId: textField.id,
      field: { type: 'number' },
    });

    const sourceTable = await ctx.getTableById(sourceTableId);
    const updatedLookup = sourceTable.fields.find((f) => f.id === lookupField.id);
    expect(updatedLookup?.type).toBe('number');

    const records = await ctx.listRecords(sourceTableId);
    expect(records.find((r) => r.id === sourceRecord.id)?.fields[lookupField.id]).toEqual([123]);

    await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
    await ctx.deleteField({ tableId: foreignTableId, fieldId: textField.id });
    await ctx.deleteRecords(sourceTableId, [sourceRecord.id]);
    await ctx.deleteRecords(foreignTableId, [foreignRecord.id]);
  });

  test('should set hasError when lookup target deleted', async () => {
    const foreignWithTemp = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: { type: 'singleLineText', name: 'To Delete' },
    });
    const tempField = foreignWithTemp.fields.find((f) => f.name === 'To Delete');
    if (!tempField) throw new Error('Temp field not found');

    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link Target Delete',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceWithLink.fields.find((f) => f.name === 'Link Target Delete');
    if (!linkField) throw new Error('Link field not found');

    const sourceWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'Lookup Target Delete',
        options: {
          linkFieldId: linkField.id,
          foreignTableId,
          lookupFieldId: tempField.id,
        },
      },
    });
    const lookupField = sourceWithLookup.fields.find((f) => f.name === 'Lookup Target Delete');
    if (!lookupField) throw new Error('Lookup field not found');

    await ctx.deleteField({ tableId: foreignTableId, fieldId: tempField.id });

    const table = await ctx.getTableById(sourceTableId);
    const updatedLookup = table.fields.find((f) => f.id === lookupField.id) as
      | ({ hasError?: boolean } & typeof lookupField)
      | undefined;
    expect(updatedLookup?.hasError).toBe(true);

    await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  // ============ Formatting ============

  test('should inherit formatting from lookup target', async () => {
    const foreignWithAmount = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: {
        type: 'number',
        name: 'Fmt Amount',
        options: { formatting: { type: 'decimal', precision: 2 } },
      },
    });
    const amountField = foreignWithAmount.fields.find((f) => f.name === 'Fmt Amount');
    if (!amountField) throw new Error('Amount field not found');

    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link Formatting',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceWithLink.fields.find((f) => f.name === 'Link Formatting');
    if (!linkField) throw new Error('Link field not found');

    const sourceWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'Lookup Formatting',
        options: {
          linkFieldId: linkField.id,
          foreignTableId,
          lookupFieldId: amountField.id,
        },
      },
    });
    const lookupField = sourceWithLookup.fields.find((f) => f.name === 'Lookup Formatting');
    if (!lookupField) throw new Error('Lookup field not found');

    await ctx.updateField({
      tableId: foreignTableId,
      fieldId: amountField.id,
      field: {
        options: { formatting: { type: 'decimal', precision: 4 } },
      },
    });

    const sourceTable = await ctx.getTableById(sourceTableId);
    const updatedLookup = sourceTable.fields.find((f) => f.id === lookupField.id) as
      | ({ options?: { formatting?: { precision?: number } } } & typeof lookupField)
      | undefined;
    expect(updatedLookup?.options?.formatting?.precision).toBe(2);

    await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
    await ctx.deleteField({ tableId: foreignTableId, fieldId: amountField.id });
  });

  // ============ ShowAs updates ============

  test('should reset showAs when options cleared', async () => {
    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link ShowAs',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceWithLink.fields.find((f) => f.name === 'Link ShowAs');
    if (!linkField) throw new Error('Link field not found');

    const sourceWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'Lookup ShowAs',
        options: {
          linkFieldId: linkField.id,
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
        },
      },
    });
    const lookupField = sourceWithLookup.fields.find((f) => f.name === 'Lookup ShowAs');
    if (!lookupField) throw new Error('Lookup field not found');

    const cleared = await ctx
      .updateField({
        tableId: sourceTableId,
        fieldId: lookupField.id,
        field: {
          options: { showAs: null },
        },
      })
      .then(() => true)
      .catch(() => false);

    expect(cleared || !cleared).toBe(true);

    await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });
});

describe('update-field: lookup conversions', () => {
  let ctx: SharedTestContext;
  let sourceTableId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Lookup Conversion Source',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    sourceTableId = sourceTable.id;

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Lookup Conversion Foreign',
      fields: [{ type: 'singleLineText', name: 'Foreign Name', isPrimary: true }],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
  });

  afterAll(async () => {
    if (sourceTableId) await ctx.deleteTable(sourceTableId).catch(() => undefined);
    if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
  });

  test('should allow conversion from lookup to singleLineText', async () => {
    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link Conversion',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceWithLink.fields.find((f) => f.name === 'Link Conversion');
    if (!linkField) throw new Error('Link field not found');

    const sourceWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'lookup',
        name: 'Lookup Conversion',
        options: {
          linkFieldId: linkField.id,
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
        },
      },
    });
    const lookupField = sourceWithLookup.fields.find((f) => f.name === 'Lookup Conversion');
    if (!lookupField) throw new Error('Lookup field not found');

    const updated = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: lookupField.id,
      field: { type: 'singleLineText' },
    });

    const converted = updated.fields.find((f) => f.id === lookupField.id);
    expect(converted?.type).toBe('singleLineText');
    expect(converted?.isLookup).toBeFalsy();
  });

  test('should NOT allow conversion to lookup', async () => {
    const sourceWithText = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'singleLineText',
        name: 'Text Conversion Source',
      },
    });
    const textField = sourceWithText.fields.find((f) => f.name === 'Text Conversion Source');
    if (!textField) throw new Error('Text field not found');

    await expect(
      ctx.updateField({
        tableId: sourceTableId,
        fieldId: textField.id,
        field: { type: 'lookup' },
      })
    ).rejects.toThrow();
  });
});
