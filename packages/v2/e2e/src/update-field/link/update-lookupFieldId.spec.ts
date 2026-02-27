/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('update-field: link lookupFieldId updates', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  it('updates symmetric link titles when lookupFieldId changes to formatted formula over lookup array', async () => {
    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('link-host-lookup-formula'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('link-foreign-lookup-formula'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'number',
          name: 'Amount',
          options: { formatting: { type: 'decimal', precision: 2 } },
        },
      ],
    });

    const table1PrimaryFieldId = table1.fields.find((field) => field.isPrimary)?.id;
    const table2PrimaryFieldId = table2.fields.find((field) => field.isPrimary)?.id;
    const table2AmountFieldId = table2.fields.find((field) => field.name === 'Amount')?.id;
    if (!table1PrimaryFieldId || !table2PrimaryFieldId || !table2AmountFieldId) {
      throw new Error('Failed to resolve initial field IDs');
    }

    const hostRecord = await ctx.createRecord(table1.id, { [table1PrimaryFieldId]: 'A1' });
    const foreignRecord1 = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: '21',
      [table2AmountFieldId]: 444,
    });
    const foreignRecord2 = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: '22',
      [table2AmountFieldId]: 555,
    });

    const linkTable1 = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'link',
        name: 'Table2 Link',
        options: {
          relationship: 'oneMany',
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryFieldId,
        },
      },
    });
    const linkField = linkTable1.fields.find((field) => field.name === 'Table2 Link');
    const symmetricFieldId = (() => {
      const options = linkField?.options as Record<string, unknown> | undefined;
      return typeof options?.symmetricFieldId === 'string' ? options.symmetricFieldId : undefined;
    })();
    if (!linkField || !symmetricFieldId) {
      throw new Error('Failed to resolve link/symmetric field');
    }

    await ctx.updateRecord(table1.id, hostRecord.id, {
      [linkField.id]: [{ id: foreignRecord1.id }, { id: foreignRecord2.id }],
    });

    const tableWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'lookup',
        name: 'Amounts (lookup)',
        options: {
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
          lookupFieldId: table2AmountFieldId,
        },
      },
    });
    const lookupAmountField = tableWithLookup.fields.find(
      (field) => field.name === 'Amounts (lookup)'
    );
    if (!lookupAmountField) {
      throw new Error('Failed to resolve lookup field');
    }

    const tableWithFormula = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'formula',
        name: 'Amounts Formula',
        options: {
          expression: `{${lookupAmountField.id}}`,
          formatting: { type: 'decimal', precision: 2 },
        },
      },
    });
    const formulaField = tableWithFormula.fields.find((field) => field.name === 'Amounts Formula');
    if (!formulaField) {
      throw new Error('Failed to resolve formula field');
    }

    await ctx.updateField({
      tableId: table2.id,
      fieldId: symmetricFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: table1.id,
          lookupFieldId: formulaField.id,
        },
      },
    });

    await ctx.drainOutbox();

    const foreignRecords = await ctx.listRecords(table2.id);
    const record21 = foreignRecords.find((record) => record.id === foreignRecord1.id);
    const record22 = foreignRecords.find((record) => record.id === foreignRecord2.id);

    expect(record21?.fields[symmetricFieldId]).toEqual({
      id: hostRecord.id,
      title: '444.00, 555.00',
    });
    expect(record22?.fields[symmetricFieldId]).toEqual({
      id: hostRecord.id,
      title: '444.00, 555.00',
    });
  });

  it('updates symmetric link titles when lookupFieldId changes to formula', async () => {
    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('link-host'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('link-foreign'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
    });

    const table1PrimaryFieldId = table1.fields.find((field) => field.isPrimary)?.id;
    const table2PrimaryFieldId = table2.fields.find((field) => field.isPrimary)?.id;
    const table2AmountFieldId = table2.fields.find((field) => field.name === 'Amount')?.id;
    if (!table1PrimaryFieldId || !table2PrimaryFieldId || !table2AmountFieldId) {
      throw new Error('Failed to resolve initial field IDs');
    }

    const hostRecord = await ctx.createRecord(table1.id, { [table1PrimaryFieldId]: 'A1' });
    const foreignRecord1 = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: '21',
      [table2AmountFieldId]: 444,
    });
    const foreignRecord2 = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: '22',
      [table2AmountFieldId]: 555,
    });

    const linkTable1 = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'link',
        name: 'Table2 Link',
        options: {
          relationship: 'oneMany',
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryFieldId,
        },
      },
    });
    const linkField = linkTable1.fields.find((field) => field.name === 'Table2 Link');
    const symmetricFieldId = (() => {
      const options = linkField?.options as Record<string, unknown> | undefined;
      return typeof options?.symmetricFieldId === 'string' ? options.symmetricFieldId : undefined;
    })();
    if (!linkField || !symmetricFieldId) {
      throw new Error('Failed to resolve link/symmetric field');
    }

    await ctx.updateRecord(table1.id, hostRecord.id, {
      [linkField.id]: [{ id: foreignRecord1.id }, { id: foreignRecord2.id }],
    });

    const tableWithRollup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'rollup',
        name: 'Sum Amounts',
        config: {
          linkFieldId: linkField.id,
          foreignTableId: table2.id,
          lookupFieldId: table2AmountFieldId,
        },
        options: {
          expression: 'sum({values})',
        },
      },
    });
    const rollupField = tableWithRollup.fields.find((field) => field.name === 'Sum Amounts');
    if (!rollupField) {
      throw new Error('Failed to resolve rollup field');
    }

    const tableWithFormula = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'formula',
        name: 'Sum Formula',
        options: {
          expression: `{${rollupField.id}}`,
          formatting: { type: 'decimal', precision: 2 },
        },
      },
    });
    const formulaField = tableWithFormula.fields.find((field) => field.name === 'Sum Formula');
    if (!formulaField) {
      throw new Error('Failed to resolve formula field');
    }

    await ctx.updateField({
      tableId: table2.id,
      fieldId: symmetricFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: table1.id,
          lookupFieldId: formulaField.id,
        },
      },
    });

    await ctx.drainOutbox();

    const foreignRecords = await ctx.listRecords(table2.id);
    const record21 = foreignRecords.find((record) => record.id === foreignRecord1.id);
    const record22 = foreignRecords.find((record) => record.id === foreignRecord2.id);

    expect(record21?.fields[symmetricFieldId]).toEqual({ id: hostRecord.id, title: '999.00' });
    expect(record22?.fields[symmetricFieldId]).toEqual({ id: hostRecord.id, title: '999.00' });
  });

  it('updates existing link titles when lookupFieldId changes from primary to another foreign field', async () => {
    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('link-host-show-by-convert'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('link-foreign-show-by-convert'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Display Text' },
      ],
    });

    const table1PrimaryFieldId = table1.fields.find((field) => field.isPrimary)?.id;
    const table2PrimaryFieldId = table2.fields.find((field) => field.isPrimary)?.id;
    const table2DisplayTextFieldId = table2.fields.find(
      (field) => field.name === 'Display Text'
    )?.id;
    if (!table1PrimaryFieldId || !table2PrimaryFieldId || !table2DisplayTextFieldId) {
      throw new Error('Failed to resolve initial field IDs');
    }

    const hostRecord = await ctx.createRecord(table1.id, { [table1PrimaryFieldId]: 'Host A' });
    const foreignRecord = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: 'A1',
      [table2DisplayTextFieldId]: 'H1',
    });

    const tableWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'link',
        name: 'Table2 Link',
        options: {
          relationship: 'oneOne',
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = tableWithLink.fields.find((field) => field.name === 'Table2 Link');
    if (!linkField) {
      throw new Error('Failed to resolve link field');
    }

    await ctx.updateRecord(table1.id, hostRecord.id, {
      [linkField.id]: { id: foreignRecord.id },
    });
    await ctx.drainOutbox();

    const recordsBeforeLookupChange = await ctx.listRecords(table1.id);
    const hostBeforeLookupChange = recordsBeforeLookupChange.find(
      (record) => record.id === hostRecord.id
    );
    expect(hostBeforeLookupChange?.fields[linkField.id]).toEqual({
      id: foreignRecord.id,
      title: 'A1',
    });

    await ctx.updateField({
      tableId: table1.id,
      fieldId: linkField.id,
      field: {
        type: 'link',
        options: {
          relationship: 'oneOne',
          foreignTableId: table2.id,
          lookupFieldId: table2DisplayTextFieldId,
          isOneWay: true,
        },
      },
    });
    await ctx.drainOutbox();

    const recordsAfterLookupChange = await ctx.listRecords(table1.id);
    const hostAfterLookupChange = recordsAfterLookupChange.find(
      (record) => record.id === hostRecord.id
    );
    expect(hostAfterLookupChange?.fields[linkField.id]).toEqual({
      id: foreignRecord.id,
      title: 'H1',
    });

    await ctx.updateRecord(table2.id, foreignRecord.id, {
      [table2DisplayTextFieldId]: 'H2',
    });
    await ctx.drainOutbox();

    const recordsAfterForeignUpdate = await ctx.listRecords(table1.id);
    const hostAfterForeignUpdate = recordsAfterForeignUpdate.find(
      (record) => record.id === hostRecord.id
    );
    expect(hostAfterForeignUpdate?.fields[linkField.id]).toEqual({
      id: foreignRecord.id,
      title: 'H2',
    });
  });

  it('updates link titles when looked-up field is converted from text to number then checkbox', async () => {
    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('link-host-convert-lookup'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('link-foreign-convert-lookup'),
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Display Text' },
      ],
    });

    const table1PrimaryFieldId = table1.fields.find((field) => field.isPrimary)?.id;
    const table2PrimaryFieldId = table2.fields.find((field) => field.isPrimary)?.id;
    const table2DisplayTextFieldId = table2.fields.find(
      (field) => field.name === 'Display Text'
    )?.id;
    if (!table1PrimaryFieldId || !table2PrimaryFieldId || !table2DisplayTextFieldId) {
      throw new Error('Failed to resolve initial field IDs');
    }

    const hostRecord = await ctx.createRecord(table1.id, { [table1PrimaryFieldId]: 'A1' });
    const foreignRecord = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: 'A1',
      [table2DisplayTextFieldId]: '11',
    });

    const tableWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'link',
        name: 'Table2 Link',
        options: {
          relationship: 'oneOne',
          foreignTableId: table2.id,
          lookupFieldId: table2DisplayTextFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = tableWithLink.fields.find((field) => field.name === 'Table2 Link');
    if (!linkField) {
      throw new Error('Failed to resolve link field');
    }

    await ctx.updateRecord(table1.id, hostRecord.id, {
      [linkField.id]: { id: foreignRecord.id },
    });
    await ctx.drainOutbox();

    const recordsBeforeConversion = await ctx.listRecords(table1.id);
    const hostBeforeConversion = recordsBeforeConversion.find(
      (record) => record.id === hostRecord.id
    );
    expect(hostBeforeConversion?.fields[linkField.id]).toEqual({
      id: foreignRecord.id,
      title: '11',
    });

    await ctx.updateField({
      tableId: table2.id,
      fieldId: table2DisplayTextFieldId,
      field: {
        type: 'number',
        options: {
          formatting: {
            type: 'decimal',
            precision: 2,
          },
        },
      },
    });
    await ctx.drainOutbox();

    const recordsAfterNumberConversion = await ctx.listRecords(table1.id);
    const hostAfterNumberConversion = recordsAfterNumberConversion.find(
      (record) => record.id === hostRecord.id
    );
    expect(hostAfterNumberConversion?.fields[linkField.id]).toEqual({
      id: foreignRecord.id,
      title: '11.00',
    });

    await ctx.updateField({
      tableId: table2.id,
      fieldId: table2DisplayTextFieldId,
      field: {
        type: 'checkbox',
      },
    });
    await ctx.drainOutbox();

    const recordsAfterCheckboxConversion = await ctx.listRecords(table1.id);
    const hostAfterCheckboxConversion = recordsAfterCheckboxConversion.find(
      (record) => record.id === hostRecord.id
    );
    expect(hostAfterCheckboxConversion?.fields[linkField.id]).toEqual({
      id: foreignRecord.id,
      title: 'A1',
    });
  });
});
