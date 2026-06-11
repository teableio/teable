/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldDto } from '@teable/v2-contract-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

type RollupFieldDto = IFieldDto & {
  type: 'rollup';
  options?: {
    expression?: string;
    formatting?: { type?: string; precision?: number };
    showAs?: { type?: string; color?: string; showValue?: boolean; maxValue?: number };
  };
  config?: {
    linkFieldId?: string;
    foreignTableId?: string;
    lookupFieldId?: string;
  };
};

const isRollupField = (field: IFieldDto | undefined): field is RollupFieldDto => {
  return field?.type === 'rollup';
};

describe('update-field: rollup property updates', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let foreignTableId: string;
  let hostPrimaryFieldId: string;
  let foreignPrimaryFieldId: string;
  let foreignAmountFieldId: string;
  let foreignQtyFieldId: string;
  let foreignTextFieldId: string;
  let linkField1Id: string;
  let linkField2Id: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createRollupField = async (name: string, expression = 'sum({values})') => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'rollup',
        id: fieldId,
        name,
        options: {
          expression,
        },
        config: {
          linkFieldId: linkField1Id,
          foreignTableId,
          lookupFieldId: foreignAmountFieldId,
        },
      },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    foreignPrimaryFieldId = createFieldId();
    foreignAmountFieldId = createFieldId();
    foreignQtyFieldId = createFieldId();
    foreignTextFieldId = createFieldId();
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rollup Update Foreign',
      fields: [
        {
          type: 'singleLineText',
          id: foreignPrimaryFieldId,
          name: 'Foreign Name',
          isPrimary: true,
        },
        { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
        { type: 'number', id: foreignQtyFieldId, name: 'Qty' },
        { type: 'singleLineText', id: foreignTextFieldId, name: 'Label' },
      ],
    });
    foreignTableId = foreignTable.id;

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rollup Update Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
    const hostPrimary = hostTable.fields.find((f) => f.isPrimary);
    if (!hostPrimary) throw new Error('No host primary field');
    hostPrimaryFieldId = hostPrimary.id;

    const withLink1 = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        id: createFieldId(),
        name: 'Foreign Link 1',
        options: {
          relationship: 'manyMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const link1 = withLink1.fields.find((f) => f.name === 'Foreign Link 1');
    if (!link1) throw new Error('No link1 field');
    linkField1Id = link1.id;

    const withLink2 = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        id: createFieldId(),
        name: 'Foreign Link 2',
        options: {
          relationship: 'manyMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const link2 = withLink2.fields.find((f) => f.name === 'Foreign Link 2');
    if (!link2) throw new Error('No link2 field');
    linkField2Id = link2.id;
  });

  afterAll(async () => {
    if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
    if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
  });

  test('should update rollup field name', async () => {
    const fieldId = await createRollupField('rollupField');

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { name: 'new rollupField' },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(field?.name).toBe('new rollupField');
    expect(isRollupField(field)).toBe(true);
    if (isRollupField(field)) {
      expect(field.options?.expression).toBe('sum({values})');
    }

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update rollup expression', async () => {
    const fieldId = await createRollupField('Expression Update', 'sum({values})');
    const f1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'E1',
      [foreignAmountFieldId]: 10,
      [foreignQtyFieldId]: 1,
    });
    const f2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'E2',
      [foreignAmountFieldId]: 20,
      [foreignQtyFieldId]: 2,
    });
    const host = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host Expression',
      [linkField1Id]: [{ id: f1.id }, { id: f2.id }],
    });

    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        options: { expression: 'countall({values})' },
      },
    });

    const records = await ctx.listRecords(hostTableId);
    expect(records.find((r) => r.id === host.id)?.fields[fieldId]).toBe(2);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [host.id]);
    await ctx.deleteRecords(foreignTableId, [f1.id, f2.id]);
  });

  test('should update rollup to different function', async () => {
    const fieldId = await createRollupField('Function Update', 'sum({values})');
    const f1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'F1',
      [foreignAmountFieldId]: 10,
    });
    const f2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'F2',
      [foreignAmountFieldId]: 20,
    });
    const host = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host Function',
      [linkField1Id]: [{ id: f1.id }, { id: f2.id }],
    });

    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        options: { expression: 'average({values})' },
      },
    });

    const records = await ctx.listRecords(hostTableId);
    expect(records.find((r) => r.id === host.id)?.fields[fieldId]).toBe(15);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [host.id]);
    await ctx.deleteRecords(foreignTableId, [f1.id, f2.id]);
  });

  test('should allow keeping expression when lookup target is text', async () => {
    const fieldId = await createRollupField('Unsupported Type', 'sum({values})');

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        config: {
          linkFieldId: linkField1Id,
          foreignTableId,
          lookupFieldId: foreignTextFieldId,
        },
        options: {
          expression: 'sum({values})',
        },
      },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(field?.type).toBe('rollup');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should update lookupFieldId', async () => {
    const fieldId = await createRollupField('Lookup Update', 'sum({values})');
    const f1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'L1',
      [foreignAmountFieldId]: 10,
      [foreignQtyFieldId]: 2,
    });
    const f2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'L2',
      [foreignAmountFieldId]: 20,
      [foreignQtyFieldId]: 3,
    });
    const host = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host Lookup',
      [linkField1Id]: [{ id: f1.id }, { id: f2.id }],
    });

    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        config: {
          linkFieldId: linkField1Id,
          foreignTableId,
          lookupFieldId: foreignQtyFieldId,
        },
        options: {
          expression: 'sum({values})',
        },
      },
    });

    const table = await ctx.getTableById(hostTableId);
    const updatedField = table.fields.find((f) => f.id === fieldId) as RollupFieldDto | undefined;
    expect(updatedField?.config?.lookupFieldId).toBe(foreignQtyFieldId);

    const records = await ctx.listRecords(hostTableId);
    expect(records.find((r) => r.id === host.id)?.fields[fieldId]).toBe(5);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [host.id]);
    await ctx.deleteRecords(foreignTableId, [f1.id, f2.id]);
  });

  test('should update number formatting', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'rollup',
        id: fieldId,
        name: 'Formatting Update',
        options: {
          expression: 'sum({values})',
          formatting: { type: 'decimal', precision: 2 },
        },
        config: {
          linkFieldId: linkField1Id,
          foreignTableId,
          lookupFieldId: foreignAmountFieldId,
        },
      },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        options: {
          expression: 'sum({values})',
          formatting: { type: 'decimal', precision: 0 },
        },
      },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isRollupField(field)).toBe(true);
    if (isRollupField(field)) {
      expect(field.options?.formatting?.precision).toBe(0);
    }

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should reset showAs when options cleared', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'rollup',
        id: fieldId,
        name: 'Clear ShowAs',
        options: {
          expression: 'sum({values})',
          showAs: { type: 'bar', color: 'green', showValue: true, maxValue: 100 },
        },
        config: {
          linkFieldId: linkField1Id,
          foreignTableId,
          lookupFieldId: foreignAmountFieldId,
        },
      },
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        options: {
          expression: 'sum({values})',
          showAs: null,
        },
      },
    });

    const field = updatedTable.fields.find((f) => f.id === fieldId);
    expect(isRollupField(field)).toBe(true);
    if (isRollupField(field)) {
      expect(field.options?.showAs).toBeUndefined();
    }

    await ctx.deleteField({ tableId: hostTableId, fieldId });
  });

  test('should cascade when lookup target type changes', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'rollup',
        id: fieldId,
        name: 'Target Type Cascade',
        options: {
          expression: 'sum({values})',
        },
        config: {
          linkFieldId: linkField1Id,
          foreignTableId,
          lookupFieldId: foreignQtyFieldId,
        },
      },
    });
    const f1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'TC1',
      [foreignQtyFieldId]: 8,
    });
    const host = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host Cascade',
      [linkField1Id]: [{ id: f1.id }],
    });

    await ctx.updateField({
      tableId: foreignTableId,
      fieldId: foreignQtyFieldId,
      field: { type: 'singleLineText' },
    });

    const hostTable = await ctx.getTableById(hostTableId);
    const rollupField = hostTable.fields.find((f) => f.id === fieldId);
    expect(rollupField?.type).toBe('rollup');

    const records = await ctx.listRecords(hostTableId);
    expect(records.find((r) => r.id === host.id)?.fields[fieldId]).toBeNull();

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [host.id]);
    await ctx.deleteRecords(foreignTableId, [f1.id]);
  });

  test('should update config when link field changes', async () => {
    const fieldId = await createRollupField('Link Change', 'sum({values})');
    const f1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'LC1',
      [foreignAmountFieldId]: 10,
    });
    const f2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'LC2',
      [foreignAmountFieldId]: 20,
    });
    const host = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host Link',
      [linkField1Id]: [{ id: f1.id }],
      [linkField2Id]: [{ id: f2.id }],
    });

    await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        config: {
          linkFieldId: linkField2Id,
          foreignTableId,
          lookupFieldId: foreignAmountFieldId,
        },
        options: {
          expression: 'sum({values})',
        },
      },
    });

    const table = await ctx.getTableById(hostTableId);
    const updatedField = table.fields.find((f) => f.id === fieldId) as RollupFieldDto | undefined;
    expect(updatedField?.config?.linkFieldId).toBe(linkField2Id);

    const records = await ctx.listRecords(hostTableId);
    expect(records.find((r) => r.id === host.id)?.fields[fieldId]).toBe(20);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [host.id]);
    await ctx.deleteRecords(foreignTableId, [f1.id, f2.id]);
  });
});

describe('update-field: rollup conversions', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;
  let foreignNumberFieldId: string;
  let linkFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rollup Conversion Foreign',
      fields: [
        {
          type: 'singleLineText',
          name: 'Foreign Name',
          isPrimary: true,
        },
        { type: 'number', name: 'Amount' },
      ],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
    const foreignNumber = foreignTable.fields.find((f) => f.name === 'Amount');
    if (!foreignNumber) throw new Error('No foreign number field');
    foreignNumberFieldId = foreignNumber.id;

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rollup Conversions',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
    const primary = table.fields.find((f) => f.isPrimary);
    if (!primary) throw new Error('No primary field');

    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'link',
        id: createFieldId(),
        name: 'Foreign Link',
        options: {
          relationship: 'manyMany',
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = withLink.fields.find((f) => f.name === 'Foreign Link');
    if (!linkField) throw new Error('No link field');
    linkFieldId = linkField.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
  });

  const createRollupField = async (name: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'rollup',
        id: fieldId,
        name,
        options: {
          expression: 'sum({values})',
        },
        config: {
          linkFieldId,
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
        },
      },
    });
    return fieldId;
  };

  test('should allow conversion from rollup to number', async () => {
    const fieldId = await createRollupField('Rollup To Number');

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('number');
    await ctx.deleteField({ tableId, fieldId });
  });

  test('should allow converting errored rollup to singleLineText', async () => {
    const fieldId = await createRollupField('Errored Rollup');

    await ctx.updateField({
      tableId: foreignTableId,
      fieldId: foreignNumberFieldId,
      field: { type: 'singleLineText' },
    });

    const updatedTable = await ctx.updateField({
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');
  });

  test('should reject conversion to rollup without required config', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: fieldId, name: 'Number Field' },
    });

    await expect(
      ctx.updateField({
        tableId,
        fieldId,
        field: { type: 'rollup' },
      })
    ).rejects.toThrow();

    await ctx.deleteField({ tableId, fieldId }).catch(() => undefined);
  });
});
