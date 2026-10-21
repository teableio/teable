/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

describe('update-field: link conversion to manyOne', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  it('should clean more link cellValue with link field many-many to many-one', async () => {
    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('convert-host'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('convert-foreign'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const table1PrimaryFieldId = table1.fields.find((field) => field.isPrimary)?.id;
    const table2PrimaryFieldId = table2.fields.find((field) => field.isPrimary)?.id;
    if (!table1PrimaryFieldId || !table2PrimaryFieldId) {
      throw new Error('Failed to resolve primary field IDs');
    }

    const hostRecord1 = await ctx.createRecord(table1.id, { [table1PrimaryFieldId]: 'table1:A1' });
    const hostRecord2 = await ctx.createRecord(table1.id, { [table1PrimaryFieldId]: 'table1:A2' });
    const foreignRecord1 = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: 'table2:A1',
    });
    const foreignRecord2 = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: 'table2:A2',
    });

    const tableWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'manyMany',
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryFieldId,
        },
      },
    });
    const linkField = tableWithLink.fields.find((field) => field.name === 'Link');
    const symmetricFieldId = (() => {
      const options = linkField?.options as Record<string, unknown> | undefined;
      return typeof options?.symmetricFieldId === 'string' ? options.symmetricFieldId : undefined;
    })();
    if (!linkField || !symmetricFieldId) {
      throw new Error('Failed to resolve manyMany link field');
    }

    await ctx.updateRecord(table1.id, hostRecord1.id, {
      [linkField.id]: [{ id: foreignRecord1.id }, { id: foreignRecord2.id }],
    });

    await ctx.updateField({
      tableId: table1.id,
      fieldId: linkField.id,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const hostRecords = await ctx.listRecords(table1.id);
    const updatedHostRecord1 = hostRecords.find((record) => record.id === hostRecord1.id);
    expect(updatedHostRecord1?.fields[linkField.id]).toEqual({
      id: foreignRecord1.id,
      title: 'table2:A1',
    });

    const foreignRecords = await ctx.listRecords(table2.id);
    const updatedForeignRecord2 = foreignRecords.find((record) => record.id === foreignRecord2.id);
    expect(updatedForeignRecord2?.fields[symmetricFieldId] ?? undefined).toBeUndefined();

    await ctx.updateRecord(table1.id, hostRecord2.id, {
      [linkField.id]: { id: foreignRecord2.id },
    });

    const hostRecordsAfterUpdate = await ctx.listRecords(table1.id);
    const updatedHostRecord2 = hostRecordsAfterUpdate.find(
      (record) => record.id === hostRecord2.id
    );
    expect(updatedHostRecord2?.fields[linkField.id]).toEqual({
      id: foreignRecord2.id,
      title: 'table2:A2',
    });
  });

  it('should clean more link cellValue with link field many-many to one-one', async () => {
    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('convert-host-oneone'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('convert-foreign-oneone'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const table1PrimaryFieldId = table1.fields.find((field) => field.isPrimary)?.id;
    const table2PrimaryFieldId = table2.fields.find((field) => field.isPrimary)?.id;
    if (!table1PrimaryFieldId || !table2PrimaryFieldId) {
      throw new Error('Failed to resolve primary field IDs');
    }

    const hostRecord1 = await ctx.createRecord(table1.id, { [table1PrimaryFieldId]: 'table1:B1' });
    const hostRecord2 = await ctx.createRecord(table1.id, { [table1PrimaryFieldId]: 'table1:B2' });
    const foreignRecord1 = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: 'table2:B1',
    });
    const foreignRecord2 = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: 'table2:B2',
    });

    const tableWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'manyMany',
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryFieldId,
          isOneWay: false,
        },
      },
    });
    const linkField = tableWithLink.fields.find((field) => field.name === 'Link');
    const symmetricFieldId = (() => {
      const options = linkField?.options as Record<string, unknown> | undefined;
      return typeof options?.symmetricFieldId === 'string' ? options.symmetricFieldId : undefined;
    })();
    if (!linkField || !symmetricFieldId) {
      throw new Error('Failed to resolve manyMany link field');
    }

    await ctx.updateRecord(table1.id, hostRecord1.id, {
      [linkField.id]: [{ id: foreignRecord1.id }, { id: foreignRecord2.id }],
    });

    await ctx.updateField({
      tableId: table1.id,
      fieldId: linkField.id,
      field: {
        type: 'link',
        options: {
          relationship: 'oneOne',
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const hostRecords = await ctx.listRecords(table1.id);
    const updatedHostRecord1 = hostRecords.find((record) => record.id === hostRecord1.id);
    expect(updatedHostRecord1?.fields[linkField.id]).toEqual({
      id: foreignRecord1.id,
      title: 'table2:B1',
    });

    const foreignRecords = await ctx.listRecords(table2.id);
    const updatedForeignRecord2 = foreignRecords.find((record) => record.id === foreignRecord2.id);
    expect(updatedForeignRecord2?.fields[symmetricFieldId] ?? undefined).toBeUndefined();

    await ctx.updateRecord(table1.id, hostRecord2.id, {
      [linkField.id]: { id: foreignRecord2.id },
    });

    const hostRecordsAfterUpdate = await ctx.listRecords(table1.id);
    const updatedHostRecord2 = hostRecordsAfterUpdate.find(
      (record) => record.id === hostRecord2.id
    );
    expect(updatedHostRecord2?.fields[linkField.id]).toEqual({
      id: foreignRecord2.id,
      title: 'table2:B2',
    });
  });

  it('should allow updating another cell to the same target after enabling many-one links', async () => {
    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('convert-oneone-manyone-host'),
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('convert-oneone-manyone-foreign'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const table1PrimaryFieldId = table1.fields.find((field) => field.isPrimary)?.id;
    const table2PrimaryFieldId = table2.fields.find((field) => field.isPrimary)?.id;
    if (!table1PrimaryFieldId || !table2PrimaryFieldId) {
      throw new Error('Failed to resolve primary field IDs');
    }

    const hostRecord1 = await ctx.createRecord(table1.id, { [table1PrimaryFieldId]: 'table1:C1' });
    const hostRecord2 = await ctx.createRecord(table1.id, { [table1PrimaryFieldId]: 'table1:C2' });
    const foreignRecord = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: 'table2:C1',
    });

    const tableWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table1.id,
      field: {
        type: 'link',
        name: 'Link',
        options: {
          relationship: 'oneOne',
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryFieldId,
          isOneWay: false,
        },
      },
    });
    const linkField = tableWithLink.fields.find((field) => field.name === 'Link');
    if (!linkField) {
      throw new Error('Failed to resolve oneOne link field');
    }

    await ctx.updateRecord(table1.id, hostRecord1.id, {
      [linkField.id]: { id: foreignRecord.id },
    });

    await ctx.updateField({
      tableId: table1.id,
      fieldId: linkField.id,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    await ctx.updateRecord(table1.id, hostRecord2.id, {
      [linkField.id]: { id: foreignRecord.id },
    });

    const hostRecords = await ctx.listRecords(table1.id);
    const updatedHostRecord1 = hostRecords.find((record) => record.id === hostRecord1.id);
    const updatedHostRecord2 = hostRecords.find((record) => record.id === hostRecord2.id);
    expect(updatedHostRecord1?.fields[linkField.id]).toEqual({
      id: foreignRecord.id,
      title: 'table2:C1',
    });
    expect(updatedHostRecord2?.fields[linkField.id]).toEqual({
      id: foreignRecord.id,
      title: 'table2:C1',
    });
  });

  it('should recompute foreign rollups for links dropped by many-many to many-one conversion', async () => {
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('convert-rollup-host'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
    });
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('convert-rollup-foreign'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
    const amountFieldId = hostTable.fields.find((field) => field.name === 'Amount')?.id;
    const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
    if (!hostPrimaryFieldId || !amountFieldId || !foreignPrimaryFieldId) {
      throw new Error('Failed to resolve field IDs');
    }

    const foreignA = await ctx.createRecord(foreignTable.id, { [foreignPrimaryFieldId]: 'A' });
    const foreignB = await ctx.createRecord(foreignTable.id, { [foreignPrimaryFieldId]: 'B' });
    const hostMoved = await ctx.createRecord(hostTable.id, {
      [hostPrimaryFieldId]: 'moved',
      [amountFieldId]: 30,
    });
    const hostStay = await ctx.createRecord(hostTable.id, {
      [hostPrimaryFieldId]: 'stay',
      [amountFieldId]: 70,
    });

    const linkOptions = {
      foreignTableId: foreignTable.id,
      lookupFieldId: foreignPrimaryFieldId,
      isOneWay: false,
    };
    const tableWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: { type: 'link', name: 'Link', options: { relationship: 'manyOne', ...linkOptions } },
    });
    const linkField = tableWithLink.fields.find((field) => field.name === 'Link');
    const symmetricFieldId = (linkField?.options as Record<string, unknown> | undefined)
      ?.symmetricFieldId;
    if (!linkField || typeof symmetricFieldId !== 'string') {
      throw new Error('Failed to resolve manyOne link field');
    }

    const foreignWithRollup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTable.id,
      field: {
        type: 'rollup',
        name: 'Total',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId: symmetricFieldId,
          foreignTableId: hostTable.id,
          lookupFieldId: amountFieldId,
        },
      },
    });
    const rollupFieldId = foreignWithRollup.fields.find((field) => field.name === 'Total')?.id;
    if (!rollupFieldId) throw new Error('Rollup field missing');

    await ctx.updateRecord(hostTable.id, hostMoved.id, { [linkField.id]: { id: foreignB.id } });
    await ctx.updateRecord(hostTable.id, hostStay.id, { [linkField.id]: { id: foreignB.id } });
    await ctx.drainOutbox();

    await ctx.updateField({
      tableId: hostTable.id,
      fieldId: linkField.id,
      field: { type: 'link', options: { relationship: 'manyMany', ...linkOptions } },
    });
    await ctx.drainOutbox();

    await ctx.updateRecord(hostTable.id, hostMoved.id, {
      [linkField.id]: [{ id: foreignA.id }, { id: foreignB.id }],
    });
    await ctx.drainOutbox();

    const rollupsBefore = await ctx.listRecords(foreignTable.id);
    expect(rollupsBefore.find((r) => r.id === foreignA.id)?.fields[rollupFieldId]).toBe(30);
    expect(rollupsBefore.find((r) => r.id === foreignB.id)?.fields[rollupFieldId]).toBe(100);

    const beforeEventCount = ctx.testContainer.eventBus.events().length;
    await ctx.updateField({
      tableId: hostTable.id,
      fieldId: linkField.id,
      field: { type: 'link', options: { relationship: 'manyOne', ...linkOptions } },
    });
    await ctx.drainOutbox();

    const foreignRefreshFieldIds = ctx.testContainer.eventBus
      .events()
      .slice(beforeEventCount)
      .map((event) => event as unknown as Record<string, unknown>)
      .filter(
        (event) =>
          String(event['name']) === 'TableActionTriggerRequested' &&
          String(event['tableId']) === foreignTable.id
      )
      .flatMap((event) => {
        expect(event['actionKey']).toBe('setField');
        expect(String(event['baseId'])).toBe(ctx.baseId);
        const payload = event['payload'] as { fieldIds?: string[] } | undefined;
        return payload?.fieldIds ?? [];
      });
    expect(foreignRefreshFieldIds).toEqual(expect.arrayContaining([rollupFieldId]));

    const hostRecords = await ctx.listRecords(hostTable.id);
    expect(hostRecords.find((r) => r.id === hostMoved.id)?.fields[linkField.id]).toEqual({
      id: foreignA.id,
      title: 'A',
    });

    const foreignRecords = await ctx.listRecords(foreignTable.id);
    const recordA = foreignRecords.find((r) => r.id === foreignA.id);
    const recordB = foreignRecords.find((r) => r.id === foreignB.id);
    expect(recordB?.fields[symmetricFieldId]).toEqual([{ id: hostStay.id, title: 'stay' }]);
    expect(recordA?.fields[rollupFieldId]).toBe(30);
    expect(recordB?.fields[rollupFieldId]).toBe(70);

    await ctx.updateRecord(hostTable.id, hostMoved.id, { [amountFieldId]: 25 });
    await ctx.drainOutbox();

    const afterAmountEdit = await ctx.listRecords(foreignTable.id);
    expect(afterAmountEdit.find((r) => r.id === foreignA.id)?.fields[rollupFieldId]).toBe(25);
    expect(afterAmountEdit.find((r) => r.id === foreignB.id)?.fields[rollupFieldId]).toBe(70);
  });

  it('should convert text to many-one link and backfill symmetric field', async () => {
    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('convert-text-host-manyone'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'TextField' },
      ],
    });
    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('convert-text-foreign-manyone'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const table1PrimaryFieldId = table1.fields.find((field) => field.isPrimary)?.id;
    const sourceFieldId = table1.fields.find((field) => field.name === 'TextField')?.id;
    const table2PrimaryFieldId = table2.fields.find((field) => field.isPrimary)?.id;
    if (!table1PrimaryFieldId || !sourceFieldId || !table2PrimaryFieldId) {
      throw new Error('Failed to resolve field IDs');
    }

    const hostRecord1 = await ctx.createRecord(table1.id, {
      [table1PrimaryFieldId]: 'table1:C1',
      [sourceFieldId]: 'x, y',
    });
    await ctx.createRecord(table1.id, {
      [table1PrimaryFieldId]: 'table1:C2',
      [sourceFieldId]: 'z',
    });
    const foreignRecord = await ctx.createRecord(table2.id, {
      [table2PrimaryFieldId]: 'x',
    });

    const updatedTable = await ctx.updateField({
      tableId: table1.id,
      fieldId: sourceFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: table2.id,
          lookupFieldId: table2PrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((field) => field.id === sourceFieldId);
    const symmetricFieldId = (() => {
      const options = updatedField?.options as Record<string, unknown> | undefined;
      return typeof options?.symmetricFieldId === 'string' ? options.symmetricFieldId : undefined;
    })();
    if (!updatedField || !symmetricFieldId) {
      throw new Error('Failed to resolve converted manyOne field');
    }

    const hostRecords = await ctx.listRecords(table1.id);
    const updatedHostRecord1 = hostRecords.find((record) => record.id === hostRecord1.id);
    expect(updatedHostRecord1?.fields[sourceFieldId]).toEqual({
      id: foreignRecord.id,
      title: 'x',
    });

    const unmatchedHostRecord = hostRecords.find((record) => record.id !== hostRecord1.id);
    expect(unmatchedHostRecord?.fields[sourceFieldId] ?? undefined).toBeUndefined();

    const foreignRecords = await ctx.listRecords(table2.id);
    const updatedForeignRecord = foreignRecords.find((record) => record.id === foreignRecord.id);
    expect(updatedForeignRecord?.fields[symmetricFieldId]).toMatchObject([{ id: hostRecord1.id }]);
  });
});
