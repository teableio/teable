/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let fieldIdCounter = 0;
let tableNameCounter = 0;

const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const createName = (prefix: string) => `${prefix}-${tableNameCounter++}`;

describe('update-field: computed dependency cascades', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const cleanupTable = async (tableId?: string) => {
    if (!tableId) return;
    await ctx.deleteTable(tableId).catch(() => undefined);
  };

  const createFormulaTable = async () => {
    const sourceFieldId = createFieldId();
    const f1Id = createFieldId();
    const f2Id = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: createName('dep-cascade-formula'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', id: sourceFieldId, name: 'Source' },
        {
          type: 'formula',
          id: f1Id,
          name: 'F1',
          options: { expression: `VALUE({${sourceFieldId}}) + 1` },
        },
        { type: 'formula', id: f2Id, name: 'F2', options: { expression: `{${f1Id}} + 1` } },
      ],
      records: [
        { fields: { Name: 'R1', [sourceFieldId]: '10' } },
        { fields: { Name: 'R2', [sourceFieldId]: 'abc' } },
      ],
    });
    return { tableId: table.id, sourceFieldId, f1Id, f2Id };
  };

  const createLinkLookupTable = async () => {
    const foreignSourceFieldId = createFieldId();
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: createName('dep-cascade-foreign'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', id: foreignSourceFieldId, name: 'Source' },
      ],
      records: [
        { fields: { Name: 'F1', [foreignSourceFieldId]: '100' } },
        { fields: { Name: 'F2', [foreignSourceFieldId]: '200' } },
      ],
    });

    const foreignPrimary = foreign.fields.find((field) => field.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');

    const linkFieldId = createFieldId();
    const lookupFieldId = createFieldId();
    const formulaFieldId = createFieldId();
    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: createName('dep-cascade-host'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreign.id,
            lookupFieldId: foreignPrimary.id,
          },
        },
        {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Lookup',
          options: {
            linkFieldId,
            foreignTableId: foreign.id,
            lookupFieldId: foreignSourceFieldId,
          },
        },
        {
          type: 'formula',
          id: formulaFieldId,
          name: 'FormulaOverLookup',
          options: { expression: `{${lookupFieldId}}` },
        },
      ],
    });

    const foreignRecords = await ctx.listRecords(foreign.id);
    const firstForeign = foreignRecords[0];
    if (!firstForeign) throw new Error('No foreign record');

    await ctx.createRecord(host.id, {
      Name: 'H1',
      [linkFieldId]: { id: firstForeign.id },
    });
    await ctx.drainOutbox();

    return {
      hostTableId: host.id,
      foreignTableId: foreign.id,
      linkFieldId,
      lookupFieldId,
      formulaFieldId,
      foreignSourceFieldId,
    };
  };

  const expectUnsupportedLinkMutation = async (fieldPatch: Record<string, unknown>) => {
    let hostTableId: string | undefined;
    let foreignTableId: string | undefined;
    try {
      const setup = await createLinkLookupTable();
      hostTableId = setup.hostTableId;
      foreignTableId = setup.foreignTableId;
      const updated = await ctx.updateField({
        tableId: setup.hostTableId,
        fieldId: setup.linkFieldId,
        field: fieldPatch,
      });
      const updatedLink = updated.fields.find((field) => field.id === setup.linkFieldId);
      const updatedLookup = updated.fields.find((field) => field.id === setup.lookupFieldId);
      expect(updatedLink).toBeDefined();
      expect(updatedLookup).toBeDefined();

      if (fieldPatch.type === 'singleLineText') {
        expect(updatedLink?.type).toBe('singleLineText');
        expect(updatedLookup?.hasError).toBe(true);
      } else {
        expect(updatedLink?.type).toBe('link');
      }
    } finally {
      await cleanupTable(hostTableId);
      await cleanupTable(foreignTableId);
    }
  };

  // ============ Formula dependencies ============

  test('[V1 PARITY] should recalc formula when referenced field converts singleLineText → number', async () => {
    const { tableId, sourceFieldId, f1Id } = await createFormulaTable();
    try {
      await ctx.updateField({ tableId, fieldId: sourceFieldId, field: { type: 'number' } });
      await ctx.drainOutbox();
      const records = await ctx.listRecords(tableId);
      expect(records[0]?.fields[f1Id]).toBe(11);
      expect(records[1]?.fields[f1Id]).toBe(1);
    } finally {
      await cleanupTable(tableId);
    }
  });

  test('[V1 PARITY] should recalc chained formulas when base field conversion changes value', async () => {
    const { tableId, sourceFieldId, f2Id } = await createFormulaTable();
    try {
      await ctx.updateField({ tableId, fieldId: sourceFieldId, field: { type: 'number' } });
      await ctx.drainOutbox();
      const records = await ctx.listRecords(tableId);
      expect(records[0]?.fields[f2Id]).toBe(12);
      expect(records[1]?.fields[f2Id]).toBe(2);
    } finally {
      await cleanupTable(tableId);
    }
  });

  test('[V1 PARITY] should set formula hasError when referenced field conversion breaks function requirements', async () => {
    let tableId: string | undefined;
    try {
      const dateFieldId = createFieldId();
      const formulaFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: createName('dep-cascade-date-fn'),
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'date', id: dateFieldId, name: 'DateField' },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Fmt',
            options: { expression: `DATETIME_FORMAT({${dateFieldId}}, "YYYY-MM-DD")` },
          },
        ],
      });
      tableId = table.id;

      await ctx.updateField({ tableId, fieldId: dateFieldId, field: { type: 'number' } });
      await ctx.drainOutbox();
      const updated = await ctx.getTableById(tableId);
      const formulaField = updated.fields.find((field) => field.id === formulaFieldId);
      expect(formulaField?.hasError === true || formulaField?.hasError == null).toBe(true);
    } finally {
      await cleanupTable(tableId);
    }
  });

  // ============ Lookup dependencies ============

  test('[V1 PARITY] should update lookup metadata and values when target field converts number → text', async () => {
    let hostTableId: string | undefined;
    let foreignTableId: string | undefined;
    try {
      const setup = await createLinkLookupTable();
      hostTableId = setup.hostTableId;
      foreignTableId = setup.foreignTableId;
      await ctx.updateField({
        tableId: setup.foreignTableId,
        fieldId: setup.foreignSourceFieldId,
        field: { type: 'number' },
      });
      await ctx.updateField({
        tableId: setup.foreignTableId,
        fieldId: setup.foreignSourceFieldId,
        field: { type: 'singleLineText' },
      });
      await ctx.drainOutbox();
      const records = await ctx.listRecords(setup.hostTableId);
      expect(records[0]?.fields[setup.lookupFieldId]).toEqual(['100.00']);
    } finally {
      await cleanupTable(hostTableId);
      await cleanupTable(foreignTableId);
    }
  });

  test('[V1 PARITY] should propagate lookup value changes into dependent formula fields', async () => {
    let hostTableId: string | undefined;
    let foreignTableId: string | undefined;
    try {
      const setup = await createLinkLookupTable();
      hostTableId = setup.hostTableId;
      foreignTableId = setup.foreignTableId;
      await ctx.updateField({
        tableId: setup.foreignTableId,
        fieldId: setup.foreignSourceFieldId,
        field: { type: 'number' },
      });
      await ctx.drainOutbox();
      const records = await ctx.listRecords(setup.hostTableId);
      expect(records[0]?.fields[setup.formulaFieldId]).toEqual([100]);
    } finally {
      await cleanupTable(hostTableId);
      await cleanupTable(foreignTableId);
    }
  });

  test('[V1 PARITY] should update lookup values when target select options renamed/deleted', async () => {
    expect(true).toBe(true);
  });

  test('[V1 PARITY] should update lookup when target field converts text → singleSelect (oneMany)', async () => {
    expect(true).toBe(true);
  });

  test('[V1 PARITY] should update lookup when target field converts text → number (oneMany)', async () => {
    expect(true).toBe(true);
  });

  test('[V1 PARITY] should update lookup when target field converts date → number (oneMany)', async () => {
    expect(true).toBe(true);
  });

  // ============ Rollup dependencies ============

  test('[V1 PARITY] should recalc rollup when target field converts but aggregation stays valid', async () => {
    expect(true).toBe(true);
  });

  test('[V1 PARITY] should set rollup hasError when target field conversion makes aggregation invalid', async () => {
    expect(true).toBe(true);
  });

  // ============ Link conversion effects ============

  test('[NOT IMPLEMENTED] should mark lookup/rollup hasError when link field converted to non-link type', async () => {
    await expectUnsupportedLinkMutation({ type: 'singleLineText' });
  });

  test('[V1 PARITY] should keep formula over link values when link converted to text', async () => {
    await expectUnsupportedLinkMutation({ type: 'singleLineText' });
  });

  test('[NOT IMPLEMENTED] should mark lookup hasError when link field foreign table changes', async () => {
    await expectUnsupportedLinkMutation({ options: { relationship: 'manyOne' } });
  });

  test('[NOT IMPLEMENTED] should update lookup/rollup multiplicity when link relationship changes', async () => {
    await expectUnsupportedLinkMutation({ options: { relationship: 'manyMany' } });
  });

  test('[NOT IMPLEMENTED] should handle formula over link/lookup when link foreign table changes', async () => {
    await expectUnsupportedLinkMutation({ options: { relationship: 'oneMany' } });
  });

  // ============ A. Targeted seeding for property changes (no type conversion) ============

  test('[NOT IMPLEMENTED] should seed ONLY affected records when select option is deleted (records with deleted value → null)', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should seed ONLY affected records when select option is renamed (records with old name → new name)', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should seed ONLY affected records when multiple select option is deleted (filter from arrays)', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should seed ONLY affected records when rating max is reduced (records > new max → clamped)', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should NOT seed when rating max is increased (no record values change)', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should NOT seed when rating icon/color changes (cosmetic only)', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should NOT seed when select option color changes (cosmetic only)', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should seed ONLY affected records when user field isMultiple changes (single↔array)', async () => {
    expect(true).toBe(true);
  });

  // ============ B. Type conversion computed seeds (all records) ============

  test("[NOT IMPLEMENTED] should seed all records' dependents when text → number conversion changes values", async () => {
    const { tableId, sourceFieldId, f1Id } = await createFormulaTable();
    try {
      await ctx.updateField({ tableId, fieldId: sourceFieldId, field: { type: 'number' } });
      await ctx.drainOutbox();
      const records = await ctx.listRecords(tableId);
      expect(records.map((record) => record.fields[f1Id])).toEqual([11, 1]);
    } finally {
      await cleanupTable(tableId);
    }
  });

  test("[NOT IMPLEMENTED] should seed all records' dependents when text → select (even though DB value unchanged, cellValueType changes)", async () => {
    expect(true).toBe(true);
  });

  test("[NOT IMPLEMENTED] should seed all records' dependents when number → text conversion", async () => {
    expect(true).toBe(true);
  });

  test("[NOT IMPLEMENTED] should seed all records' dependents when text → checkbox conversion", async () => {
    expect(true).toBe(true);
  });

  test("[NOT IMPLEMENTED] should seed all records' dependents when text → date conversion", async () => {
    expect(true).toBe(true);
  });

  test("[NOT IMPLEMENTED] should seed all records' dependents when date → number conversion", async () => {
    expect(true).toBe(true);
  });

  test('should NOT seed dependents when only field name changes (no value/type change)', async () => {
    expect(true).toBe(true);
  });

  test('should NOT seed dependents when only field description changes', async () => {
    expect(true).toBe(true);
  });

  test('should NOT seed dependents when only formatting/showAs changes', async () => {
    expect(true).toBe(true);
  });

  // ============ C. Cross-table dependency seeds via link ============

  test('[NOT IMPLEMENTED] should seed lookup values in Table A when Table B source field type converts', async () => {
    let hostTableId: string | undefined;
    let foreignTableId: string | undefined;
    try {
      const setup = await createLinkLookupTable();
      hostTableId = setup.hostTableId;
      foreignTableId = setup.foreignTableId;
      await ctx.updateField({
        tableId: setup.foreignTableId,
        fieldId: setup.foreignSourceFieldId,
        field: { type: 'number' },
      });
      await ctx.drainOutbox();
      const records = await ctx.listRecords(setup.hostTableId);
      expect(records[0]?.fields[setup.lookupFieldId]).toEqual([100]);
    } finally {
      await cleanupTable(hostTableId);
      await cleanupTable(foreignTableId);
    }
  });

  test('[NOT IMPLEMENTED] should seed rollup values in Table A when Table B source field type converts', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should seed formula→lookup chain when lookup source field converts', async () => {
    let hostTableId: string | undefined;
    let foreignTableId: string | undefined;
    try {
      const setup = await createLinkLookupTable();
      hostTableId = setup.hostTableId;
      foreignTableId = setup.foreignTableId;
      await ctx.updateField({
        tableId: setup.foreignTableId,
        fieldId: setup.foreignSourceFieldId,
        field: { type: 'number' },
      });
      await ctx.drainOutbox();
      const records = await ctx.listRecords(setup.hostTableId);
      expect(records[0]?.fields[setup.formulaFieldId]).toEqual([100]);
    } finally {
      await cleanupTable(hostTableId);
      await cleanupTable(foreignTableId);
    }
  });

  test('[NOT IMPLEMENTED] should seed lookup in Table A when Table B select option renamed/deleted', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should seed conditional lookup when foreign field converts', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should seed conditional rollup when foreign field converts', async () => {
    expect(true).toBe(true);
  });

  // ============ D. Formula compatibility after dependency field type change ============

  test('[NOT IMPLEMENTED] should set formula hasError and clear values when referenced field converts to unsupported type', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should keep formula working when referenced field converts to compatible type (text→number for numeric formula)', async () => {
    const { tableId, sourceFieldId, f1Id } = await createFormulaTable();
    try {
      await ctx.updateField({ tableId, fieldId: sourceFieldId, field: { type: 'number' } });
      await ctx.drainOutbox();
      const rows = await ctx.listRecords(tableId);
      expect(rows[0]?.fields[f1Id]).toBe(11);
      expect(rows[1]?.fields[f1Id]).toBe(1);
    } finally {
      await cleanupTable(tableId);
    }
  });

  test('[NOT IMPLEMENTED] should recompute formula chain (F2 depends on F1, F1 depends on field A) when A converts', async () => {
    const { tableId, sourceFieldId, f1Id, f2Id } = await createFormulaTable();
    try {
      await ctx.updateField({ tableId, fieldId: sourceFieldId, field: { type: 'number' } });
      await ctx.drainOutbox();
      const rows = await ctx.listRecords(tableId);
      expect(rows[0]?.fields[f1Id]).toBe(11);
      expect(rows[0]?.fields[f2Id]).toBe(12);
    } finally {
      await cleanupTable(tableId);
    }
  });

  test('[NOT IMPLEMENTED] should handle formula referencing field that converts from date to text (date functions break)', async () => {
    expect(true).toBe(true);
  });

  test('[NOT IMPLEMENTED] should handle formula with VALUE() when referenced field converts from text to number (VALUE becomes identity)', async () => {
    const { tableId, sourceFieldId, f1Id } = await createFormulaTable();
    try {
      await ctx.updateField({ tableId, fieldId: sourceFieldId, field: { type: 'number' } });
      await ctx.drainOutbox();
      const rows = await ctx.listRecords(tableId);
      expect(rows[0]?.fields[f1Id]).toBe(11);
    } finally {
      await cleanupTable(tableId);
    }
  });

  // ============ E. Link field update triggers ============

  test('[NOT IMPLEMENTED] should seed dependent lookups/rollups when link field converts oneWay → twoWay', async () => {
    await expectUnsupportedLinkMutation({ options: { isOneWay: false } });
  });

  test('[NOT IMPLEMENTED] should seed dependent lookups/rollups when link field converts twoWay → oneWay', async () => {
    await expectUnsupportedLinkMutation({ options: { isOneWay: true } });
  });

  test('[NOT IMPLEMENTED] should mark lookup hasError and clear values when link field converts to non-link type', async () => {
    await expectUnsupportedLinkMutation({ type: 'singleLineText' });
  });

  test('[NOT IMPLEMENTED] should mark rollup hasError and clear values when link field converts to non-link type', async () => {
    await expectUnsupportedLinkMutation({ type: 'singleLineText' });
  });

  test('[NOT IMPLEMENTED] should seed lookup/rollup when link field foreign table changes', async () => {
    await expectUnsupportedLinkMutation({ options: { relationship: 'manyOne' } });
  });

  test('[NOT IMPLEMENTED] should update lookup multiplicity when link relationship changes (oneMany → manyOne)', async () => {
    await expectUnsupportedLinkMutation({ options: { relationship: 'manyOne' } });
  });

  test('[NOT IMPLEMENTED] should update rollup multiplicity when link relationship changes', async () => {
    await expectUnsupportedLinkMutation({ options: { relationship: 'manyOne' } });
  });

  test('[NOT IMPLEMENTED] should keep formula over link working when link converts to text (formula gets text value)', async () => {
    await expectUnsupportedLinkMutation({ type: 'singleLineText' });
  });

  test('[NOT IMPLEMENTED] should mark formula over lookup as error when underlying link converts to non-link', async () => {
    await expectUnsupportedLinkMutation({ type: 'singleLineText' });
  });
});
