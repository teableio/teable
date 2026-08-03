/**
 * E2E tests for computed field cascade after schema updates.
 *
 * These tests verify that when a field's stored values change (option rename,
 * rating max reduction, formula expression change, etc.), dependent computed
 * fields (formulas, lookups, rollups) are recalculated.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let fieldIdCounter = 0;
const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

describe('update-field: cascade after schema update (same-table)', () => {
  let ctx: SharedTestContext;
  let tableId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Cascade Same Table',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) {
      try {
        await ctx.deleteTable(tableId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // ============ Rating max reduction → cascade ============

  test('should recompute dependent formula when rating max is reduced', async () => {
    const ratingFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'rating',
        id: ratingFieldId,
        name: 'Rating',
        options: { max: 5, icon: 'star', color: 'yellowBright' },
      },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Rating x10',
        options: { expression: `{${ratingFieldId}} * 10` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [ratingFieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [ratingFieldId]: 3 });
    const r3 = await ctx.createRecord(tableId, { [ratingFieldId]: 5 });

    // Verify initial formula values
    const beforeRecords = await ctx.listRecords(tableId);
    expect(beforeRecords.find((r) => r.id === r1.id)?.fields[formulaFieldId]).toBe(10);
    expect(beforeRecords.find((r) => r.id === r2.id)?.fields[formulaFieldId]).toBe(30);
    expect(beforeRecords.find((r) => r.id === r3.id)?.fields[formulaFieldId]).toBe(50);

    // Action: Reduce rating max to 3
    await ctx.updateField({
      tableId,
      fieldId: ratingFieldId,
      field: { options: { max: 3 } },
    });

    // Assert: R values clamped, F values recomputed
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);

    expect(rec1?.fields[ratingFieldId]).toBe(1);
    expect(rec2?.fields[ratingFieldId]).toBe(3);
    expect(rec3?.fields[ratingFieldId]).toBe(3); // clamped from 5

    expect(rec1?.fields[formulaFieldId]).toBe(10);
    expect(rec2?.fields[formulaFieldId]).toBe(30);
    expect(rec3?.fields[formulaFieldId]).toBe(30); // recomputed from clamped 3

    // Cleanup
    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: ratingFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  test('should not cascade when rating max is increased', async () => {
    const ratingFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'rating',
        id: ratingFieldId,
        name: 'Rating Inc',
        options: { max: 3, icon: 'star', color: 'yellowBright' },
      },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Rating Inc x10',
        options: { expression: `{${ratingFieldId}} * 10` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [ratingFieldId]: 1 });
    const r2 = await ctx.createRecord(tableId, { [ratingFieldId]: 2 });
    const r3 = await ctx.createRecord(tableId, { [ratingFieldId]: 3 });

    // Action: Increase rating max to 5
    await ctx.updateField({
      tableId,
      fieldId: ratingFieldId,
      field: { options: { max: 5 } },
    });

    // Assert: All values unchanged
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);

    expect(rec1?.fields[ratingFieldId]).toBe(1);
    expect(rec2?.fields[ratingFieldId]).toBe(2);
    expect(rec3?.fields[ratingFieldId]).toBe(3);

    expect(rec1?.fields[formulaFieldId]).toBe(10);
    expect(rec2?.fields[formulaFieldId]).toBe(20);
    expect(rec3?.fields[formulaFieldId]).toBe(30);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: ratingFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  // ============ Select option rename → cascade ============

  test('should recompute dependent formula when single select option is renamed', async () => {
    const selectFieldId = createFieldId();
    const redOption = { id: 'choRed', name: 'Red', color: 'redBright' as const };
    const blueOption = { id: 'choBlue', name: 'Blue', color: 'blueBright' as const };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: selectFieldId,
        name: 'Color',
        options: { choices: [redOption, blueOption] },
      },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Color Bang',
        options: { expression: `{${selectFieldId}} & "!"` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [selectFieldId]: 'Red' });
    const r2 = await ctx.createRecord(tableId, { [selectFieldId]: 'Blue' });

    // Verify initial formula values
    const beforeRecords = await ctx.listRecords(tableId);
    expect(beforeRecords.find((r) => r.id === r1.id)?.fields[formulaFieldId]).toBe('Red!');
    expect(beforeRecords.find((r) => r.id === r2.id)?.fields[formulaFieldId]).toBe('Blue!');

    // Action: Rename "Red" → "Crimson" (keep same id)
    const crimsonOption = { ...redOption, name: 'Crimson' };
    await ctx.updateField({
      tableId,
      fieldId: selectFieldId,
      field: { options: { choices: [crimsonOption, blueOption] } },
    });

    // Assert: S values updated, F values recomputed
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);

    expect(rec1?.fields[selectFieldId]).toBe('Crimson');
    expect(rec2?.fields[selectFieldId]).toBe('Blue');
    expect(rec1?.fields[formulaFieldId]).toBe('Crimson!');
    expect(rec2?.fields[formulaFieldId]).toBe('Blue!');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: selectFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should recompute dependent formula when multiple select option is renamed', async () => {
    const msFieldId = createFieldId();
    const optionA = { id: 'choA', name: 'A', color: 'blueBright' as const };
    const optionB = { id: 'choB', name: 'B', color: 'greenBright' as const };
    const optionC = { id: 'choC', name: 'C', color: 'yellowBright' as const };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: msFieldId,
        name: 'Tags',
        options: { choices: [optionA, optionB, optionC] },
      },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Tag Join',
        options: { expression: `ARRAYJOIN({${msFieldId}}, ",")` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [msFieldId]: ['A', 'B'] });
    const r2 = await ctx.createRecord(tableId, { [msFieldId]: ['B', 'C'] });

    // Verify initial values
    const beforeRecords = await ctx.listRecords(tableId);
    expect(beforeRecords.find((r) => r.id === r1.id)?.fields[msFieldId]).toEqual(['A', 'B']);
    expect(beforeRecords.find((r) => r.id === r2.id)?.fields[msFieldId]).toEqual(['B', 'C']);

    // Action: Rename "B" → "Beta"
    const optionBeta = { ...optionB, name: 'Beta' };
    await ctx.updateField({
      tableId,
      fieldId: msFieldId,
      field: { options: { choices: [optionA, optionBeta, optionC] } },
    });

    // Assert: MS values updated, F values recomputed
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);

    expect(rec1?.fields[msFieldId]).toEqual(['A', 'Beta']);
    expect(rec2?.fields[msFieldId]).toEqual(['Beta', 'C']);
    expect(rec1?.fields[formulaFieldId]).toBe('A,Beta');
    expect(rec2?.fields[formulaFieldId]).toBe('Beta,C');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: msFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should recompute dependent formula when select option is removed', async () => {
    const selectFieldId = createFieldId();
    const optionX = { id: 'choX', name: 'X', color: 'blueBright' as const };
    const optionY = { id: 'choY', name: 'Y', color: 'greenBright' as const };
    const optionZ = { id: 'choZ', name: 'Z', color: 'yellowBright' as const };
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: selectFieldId,
        name: 'Letter',
        options: { choices: [optionX, optionY, optionZ] },
      },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Letter Or None',
        options: { expression: `IF({${selectFieldId}}, {${selectFieldId}}, "none")` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [selectFieldId]: 'X' });
    const r2 = await ctx.createRecord(tableId, { [selectFieldId]: 'Y' });
    const r3 = await ctx.createRecord(tableId, { [selectFieldId]: 'Z' });

    // Verify initial formula values
    const beforeRecords = await ctx.listRecords(tableId);
    expect(beforeRecords.find((r) => r.id === r1.id)?.fields[formulaFieldId]).toBe('X');
    expect(beforeRecords.find((r) => r.id === r2.id)?.fields[formulaFieldId]).toBe('Y');
    expect(beforeRecords.find((r) => r.id === r3.id)?.fields[formulaFieldId]).toBe('Z');

    // Action: Remove option Y (pass choices = [X, Z])
    await ctx.updateField({
      tableId,
      fieldId: selectFieldId,
      field: { options: { choices: [optionX, optionZ] } },
    });

    // Assert: S values — Y becomes null; F recomputes
    const records = await ctx.listRecords(tableId);
    const rec1 = records.find((r) => r.id === r1.id);
    const rec2 = records.find((r) => r.id === r2.id);
    const rec3 = records.find((r) => r.id === r3.id);

    expect(rec1?.fields[selectFieldId]).toBe('X');
    expect(rec2?.fields[selectFieldId]).toBeNull();
    expect(rec3?.fields[selectFieldId]).toBe('Z');
    expect(rec1?.fields[formulaFieldId]).toBe('X');
    expect(rec2?.fields[formulaFieldId]).toBe('none');
    expect(rec3?.fields[formulaFieldId]).toBe('Z');

    // Cleanup
    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: selectFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id, r3.id]);
  });

  // ============ Formula expression change → cascade ============

  test('should self-backfill formula when expression changes', async () => {
    const numberFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: numberFieldId, name: 'Num' },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Calc',
        options: { expression: `{${numberFieldId}} + 1` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [numberFieldId]: 10 });
    const r2 = await ctx.createRecord(tableId, { [numberFieldId]: 20 });

    const beforeRecords = await ctx.listRecords(tableId);
    expect(beforeRecords.find((r) => r.id === r1.id)?.fields[formulaFieldId]).toBe(11);
    expect(beforeRecords.find((r) => r.id === r2.id)?.fields[formulaFieldId]).toBe(21);

    // Action: Change expression to {N} + 100
    await ctx.updateField({
      tableId,
      fieldId: formulaFieldId,
      field: { options: { expression: `{${numberFieldId}} + 100` } },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[formulaFieldId]).toBe(110);
    expect(records.find((r) => r.id === r2.id)?.fields[formulaFieldId]).toBe(120);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId, fieldId: numberFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });

  test('should recompute formula and cascade to dependent formula on expression change', async () => {
    const numberFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'number', id: numberFieldId, name: 'Base Num' },
    });

    const formula1FieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formula1FieldId,
        name: 'F1',
        options: { expression: `{${numberFieldId}} + 1` },
      },
    });

    const formula2FieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        id: formula2FieldId,
        name: 'F2',
        options: { expression: `{${formula1FieldId}} * 2` },
      },
    });

    const r1 = await ctx.createRecord(tableId, { [numberFieldId]: 10 });
    const r2 = await ctx.createRecord(tableId, { [numberFieldId]: 20 });

    const beforeRecords = await ctx.listRecords(tableId);
    expect(beforeRecords.find((r) => r.id === r1.id)?.fields[formula1FieldId]).toBe(11);
    expect(beforeRecords.find((r) => r.id === r2.id)?.fields[formula1FieldId]).toBe(21);
    expect(beforeRecords.find((r) => r.id === r1.id)?.fields[formula2FieldId]).toBe(22);
    expect(beforeRecords.find((r) => r.id === r2.id)?.fields[formula2FieldId]).toBe(42);

    // Action: Change F1 expression to {N} + 100
    await ctx.updateField({
      tableId,
      fieldId: formula1FieldId,
      field: { options: { expression: `{${numberFieldId}} + 100` } },
    });

    const records = await ctx.listRecords(tableId);
    expect(records.find((r) => r.id === r1.id)?.fields[formula1FieldId]).toBe(110);
    expect(records.find((r) => r.id === r2.id)?.fields[formula1FieldId]).toBe(120);
    expect(records.find((r) => r.id === r1.id)?.fields[formula2FieldId]).toBe(220);
    expect(records.find((r) => r.id === r2.id)?.fields[formula2FieldId]).toBe(240);

    // Cleanup
    await ctx.deleteField({ tableId, fieldId: formula2FieldId });
    await ctx.deleteField({ tableId, fieldId: formula1FieldId });
    await ctx.deleteField({ tableId, fieldId: numberFieldId });
    await ctx.deleteRecords(tableId, [r1.id, r2.id]);
  });
});

describe('update-field: cascade after schema update (cross-table)', () => {
  let ctx: SharedTestContext;
  let tableAId: string;
  let tableBId: string;

  // Table A fields
  let aPrimaryFieldId: string;
  let aSelectFieldId: string;
  let aRatingFieldId: string;
  let aAmountFieldId: string;
  let aQuantityFieldId: string;

  // Table B fields
  let bPrimaryFieldId: string;
  let linkFieldId: string;

  const selectAlpha = { id: 'choAlpha', name: 'Alpha', color: 'blueBright' as const };
  const selectBeta = { id: 'choBeta', name: 'Beta', color: 'greenBright' as const };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create Table A (foreign table - source of data)
    aPrimaryFieldId = createFieldId();
    aSelectFieldId = createFieldId();
    aRatingFieldId = createFieldId();
    aAmountFieldId = createFieldId();
    aQuantityFieldId = createFieldId();

    const tableA = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Cascade Foreign',
      fields: [
        { type: 'singleLineText', id: aPrimaryFieldId, name: 'Name', isPrimary: true },
        {
          type: 'singleSelect',
          id: aSelectFieldId,
          name: 'Status',
          options: { choices: [selectAlpha, selectBeta] },
        },
        {
          type: 'rating',
          id: aRatingFieldId,
          name: 'Score',
          options: { max: 5, icon: 'star', color: 'yellowBright' },
        },
        { type: 'number', id: aAmountFieldId, name: 'Amount' },
        { type: 'number', id: aQuantityFieldId, name: 'Quantity' },
      ],
    });
    tableAId = tableA.id;

    // Create Table B (host table - has link, lookup, rollup)
    bPrimaryFieldId = createFieldId();
    linkFieldId = createFieldId();

    const tableB = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Cascade Host',
      fields: [
        { type: 'singleLineText', id: bPrimaryFieldId, name: 'Label', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'LinkA',
          options: {
            relationship: 'manyOne',
            foreignTableId: tableAId,
            lookupFieldId: aPrimaryFieldId,
          },
        },
      ],
    });
    tableBId = tableB.id;
  }, 30000);

  afterAll(async () => {
    try {
      if (tableBId) await ctx.deleteTable(tableBId);
    } catch {
      // ignore
    }
    try {
      if (tableAId) await ctx.deleteTable(tableAId);
    } catch {
      // ignore
    }
  });

  // ============ Cross-table: select rename → lookup cascade ============

  test('should cascade to lookup when source select option is renamed', async () => {
    // Create records in Table A
    const recA1 = await ctx.createRecord(tableAId, {
      [aPrimaryFieldId]: 'Row1',
      [aSelectFieldId]: 'Alpha',
    });
    const recA2 = await ctx.createRecord(tableAId, {
      [aPrimaryFieldId]: 'Row2',
      [aSelectFieldId]: 'Beta',
    });

    // Create lookup in Table B looking up Table A's Status
    const lookupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Status Lookup',
        options: {
          linkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: aSelectFieldId,
        },
      },
    });

    // Link Table B record to Table A record
    const recB = await ctx.createRecord(tableBId, {
      [bPrimaryFieldId]: 'B1',
      [linkFieldId]: { id: recA1.id },
    });

    await ctx.drainOutbox();

    // Verify initial lookup
    let bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    let bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[lookupFieldId]).toEqual(['Alpha']);

    // Action: Rename "Alpha" → "Omega" in Table A
    const selectOmega = { ...selectAlpha, name: 'Omega' };
    await ctx.updateField({
      tableId: tableAId,
      fieldId: aSelectFieldId,
      field: { options: { choices: [selectOmega, selectBeta] } },
    });

    await ctx.drainOutbox();

    // Assert: Table A values updated
    const aRecords = await ctx.listRecordsWithoutDrain(tableAId);
    expect(aRecords.find((r) => r.id === recA1.id)?.fields[aSelectFieldId]).toBe('Omega');
    expect(aRecords.find((r) => r.id === recA2.id)?.fields[aSelectFieldId]).toBe('Beta');

    // Assert: Table B lookup cascaded
    bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[lookupFieldId]).toEqual(['Omega']);

    // Restore option name for other tests
    await ctx.updateField({
      tableId: tableAId,
      fieldId: aSelectFieldId,
      field: { options: { choices: [selectAlpha, selectBeta] } },
    });

    // Cleanup
    await ctx.deleteField({ tableId: tableBId, fieldId: lookupFieldId });
    await ctx.deleteRecords(tableBId, [recB.id]);
    await ctx.deleteRecords(tableAId, [recA1.id, recA2.id]);
  });

  // ============ Cross-table: rating max reduction → rollup cascade ============

  test('should cascade to rollup when source rating max is reduced', async () => {
    // Create records in Table A with rating values
    const recA1 = await ctx.createRecord(tableAId, {
      [aPrimaryFieldId]: 'R1',
      [aRatingFieldId]: 5,
    });
    const recA2 = await ctx.createRecord(tableAId, {
      [aPrimaryFieldId]: 'R2',
      [aRatingFieldId]: 4,
    });
    const recA3 = await ctx.createRecord(tableAId, {
      [aPrimaryFieldId]: 'R3',
      [aRatingFieldId]: 3,
    });

    // Create rollup in Table B: SUM of Table A's Score
    const rollupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'rollup',
        id: rollupFieldId,
        name: 'Score Sum',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: aRatingFieldId,
        },
      },
    });

    // Link all A records to a single B record
    const recB = await ctx.createRecord(tableBId, {
      [bPrimaryFieldId]: 'RollupHost',
      [linkFieldId]: { id: recA1.id },
    });

    await ctx.drainOutbox();

    // Verify initial rollup (only recA1 is linked, so sum = 5)
    let bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    let bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[rollupFieldId]).toBe(5);

    // Action: Reduce Table A rating max to 3
    await ctx.updateField({
      tableId: tableAId,
      fieldId: aRatingFieldId,
      field: { options: { max: 3 } },
    });

    await ctx.drainOutbox();

    // Assert: Table A values clamped
    const aRecords = await ctx.listRecordsWithoutDrain(tableAId);
    expect(aRecords.find((r) => r.id === recA1.id)?.fields[aRatingFieldId]).toBe(3); // 5→3
    expect(aRecords.find((r) => r.id === recA2.id)?.fields[aRatingFieldId]).toBe(3); // 4→3
    expect(aRecords.find((r) => r.id === recA3.id)?.fields[aRatingFieldId]).toBe(3); // unchanged

    // Assert: Table B rollup recomputed (linked to recA1, now clamped to 3)
    bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[rollupFieldId]).toBe(3);

    // Restore max for other tests
    await ctx.updateField({
      tableId: tableAId,
      fieldId: aRatingFieldId,
      field: { options: { max: 5 } },
    });

    // Cleanup
    await ctx.deleteField({ tableId: tableBId, fieldId: rollupFieldId });
    await ctx.deleteRecords(tableBId, [recB.id]);
    await ctx.deleteRecords(tableAId, [recA1.id, recA2.id, recA3.id]);
  });

  // ============ Lookup config change → cascade ============

  test('should recompute lookup when lookupFieldId changes', async () => {
    // Create records in Table A
    const recA = await ctx.createRecord(tableAId, {
      [aPrimaryFieldId]: 'LookupRow',
      [aAmountFieldId]: 100,
      [aQuantityFieldId]: 7,
    });

    // Create lookup in Table B looking up Amount
    const lookupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Value Lookup',
        options: {
          linkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: aAmountFieldId,
        },
      },
    });

    const recB = await ctx.createRecord(tableBId, {
      [bPrimaryFieldId]: 'LookupHost',
      [linkFieldId]: { id: recA.id },
    });

    await ctx.drainOutbox();

    // Verify initial lookup shows Amount
    let bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    let bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[lookupFieldId]).toEqual([100]);

    // Action: Change lookup to point at Quantity instead of Amount
    await ctx.updateField({
      tableId: tableBId,
      fieldId: lookupFieldId,
      field: {
        options: {
          linkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: aQuantityFieldId,
        },
      },
    });

    await ctx.drainOutbox();

    // Assert: Lookup self-backfills with Quantity values
    bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[lookupFieldId]).toEqual([7]);

    // Cleanup
    await ctx.deleteField({ tableId: tableBId, fieldId: lookupFieldId });
    await ctx.deleteRecords(tableBId, [recB.id]);
    await ctx.deleteRecords(tableAId, [recA.id]);
  });

  test('should recompute lookup and cascade to dependent formula on config change', async () => {
    const recA = await ctx.createRecord(tableAId, {
      [aPrimaryFieldId]: 'CascadeLookupRow',
      [aAmountFieldId]: 50,
      [aQuantityFieldId]: 3,
    });

    // Create lookup
    const lookupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Cascade Lookup',
        options: {
          linkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: aAmountFieldId,
        },
      },
    });

    // Create formula depending on the lookup
    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Lookup Label',
        options: { expression: `CONCATENATE("val=", {${lookupFieldId}})` },
      },
    });

    const recB = await ctx.createRecord(tableBId, {
      [bPrimaryFieldId]: 'CascadeHost',
      [linkFieldId]: { id: recA.id },
    });

    await ctx.drainOutbox();

    // Verify initial state
    let bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    let bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[lookupFieldId]).toEqual([50]);

    // Action: Switch lookup target to Quantity
    await ctx.updateField({
      tableId: tableBId,
      fieldId: lookupFieldId,
      field: {
        options: {
          linkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: aQuantityFieldId,
        },
      },
    });

    await ctx.drainOutbox();

    // Assert: Lookup self-backfills, formula cascades
    bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[lookupFieldId]).toEqual([3]);
    // v2 applies default number formatting (precision=2) when coercing to text in formulas
    expect(bRec?.fields[formulaFieldId]).toMatch(/^val=3(\.00)?$/);

    // Cleanup
    await ctx.deleteField({ tableId: tableBId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId: tableBId, fieldId: lookupFieldId });
    await ctx.deleteRecords(tableBId, [recB.id]);
    await ctx.deleteRecords(tableAId, [recA.id]);
  });

  test('[V1 PARITY] should keep lookup options/values when target text converts to singleSelect', async () => {
    const sourceTextFieldId = createFieldId();
    const sourceLinkFieldId = createFieldId();
    const lookupFieldId = createFieldId();
    let recA1Id: string | undefined;
    let recA2Id: string | undefined;
    let recBId: string | undefined;

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableAId,
      field: {
        type: 'singleLineText',
        id: sourceTextFieldId,
        name: 'Lookup Source Text',
      },
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'link',
        id: sourceLinkFieldId,
        name: 'OneMany Source Link',
        options: {
          relationship: 'oneMany',
          foreignTableId: tableAId,
          lookupFieldId: aPrimaryFieldId,
          isOneWay: true,
        },
      },
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Source Text Lookup',
        options: {
          linkFieldId: sourceLinkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: sourceTextFieldId,
        },
      },
    });

    try {
      const recA1 = await ctx.createRecord(tableAId, {
        [aPrimaryFieldId]: 'TextRow1',
        [sourceTextFieldId]: 'text 1',
      });
      const recA2 = await ctx.createRecord(tableAId, {
        [aPrimaryFieldId]: 'TextRow2',
        [sourceTextFieldId]: 'text 2',
      });
      recA1Id = recA1.id;
      recA2Id = recA2.id;

      const recB = await ctx.createRecord(tableBId, {
        [bPrimaryFieldId]: 'LookupHost',
        [sourceLinkFieldId]: [{ id: recA1.id }, { id: recA2.id }],
      });
      recBId = recB.id;

      await ctx.drainOutbox();

      let hostRecords = await ctx.listRecordsWithoutDrain(tableBId);
      let hostRecord = hostRecords.find((r) => r.id === recB.id);
      expect(hostRecord?.fields[lookupFieldId]).toEqual(['text 1', 'text 2']);

      await ctx.updateField({
        tableId: tableAId,
        fieldId: sourceTextFieldId,
        field: { type: 'singleSelect' },
      });

      await ctx.drainOutbox();

      hostRecords = await ctx.listRecordsWithoutDrain(tableBId);
      hostRecord = hostRecords.find((r) => r.id === recB.id);
      expect(hostRecord?.fields[lookupFieldId]).toEqual(['text 1', 'text 2']);

      const hostTable = await ctx.getTableById(tableBId);
      const lookupField = hostTable.fields.find((field) => field.id === lookupFieldId) as
        | {
            options?: {
              choices?: Array<{ name?: string }>;
            };
          }
        | undefined;
      const choiceNames = (lookupField?.options?.choices ?? [])
        .map((choice) => choice.name)
        .filter((name): name is string => Boolean(name))
        .sort();
      expect(choiceNames).toEqual(['text 1', 'text 2']);
    } finally {
      await ctx.deleteField({ tableId: tableBId, fieldId: lookupFieldId });
      await ctx.deleteField({ tableId: tableBId, fieldId: sourceLinkFieldId });
      await ctx.deleteField({ tableId: tableAId, fieldId: sourceTextFieldId });
      if (recBId) {
        await ctx.deleteRecords(tableBId, [recBId]);
      }
      const foreignRecordIds = [recA1Id, recA2Id].filter((id): id is string => Boolean(id));
      if (foreignRecordIds.length) {
        await ctx.deleteRecords(tableAId, foreignRecordIds);
      }
    }
  });

  test('[V1 PARITY] should convert lookup values to timestamp when target date converts to number', async () => {
    const sourceDateFieldId = createFieldId();
    const sourceLinkFieldId = createFieldId();
    const lookupFieldId = createFieldId();
    let recAId: string | undefined;
    let recBId: string | undefined;

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableAId,
      field: {
        type: 'date',
        id: sourceDateFieldId,
        name: 'Lookup Source Date',
      },
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'link',
        id: sourceLinkFieldId,
        name: 'Date OneMany Link',
        options: {
          relationship: 'oneMany',
          foreignTableId: tableAId,
          lookupFieldId: aPrimaryFieldId,
          isOneWay: true,
        },
      },
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Date Lookup',
        options: {
          linkFieldId: sourceLinkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: sourceDateFieldId,
        },
      },
    });

    try {
      const recA = await ctx.createRecord(tableAId, {
        [aPrimaryFieldId]: 'DateRow',
        [sourceDateFieldId]: '2026-02-16T00:00:00.000Z',
      });
      recAId = recA.id;

      const recB = await ctx.createRecord(tableBId, {
        [bPrimaryFieldId]: 'DateLookupHost',
        [sourceLinkFieldId]: [{ id: recA.id }],
      });
      recBId = recB.id;

      await ctx.drainOutbox();

      await ctx.updateField({
        tableId: tableAId,
        fieldId: sourceDateFieldId,
        field: { type: 'number' },
      });

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecordsWithoutDrain(tableBId);
      const hostRecord = hostRecords.find((r) => r.id === recB.id);
      expect(hostRecord?.fields[lookupFieldId]).toEqual([1771200000000]);
    } finally {
      await ctx.deleteField({ tableId: tableBId, fieldId: lookupFieldId });
      await ctx.deleteField({ tableId: tableBId, fieldId: sourceLinkFieldId });
      await ctx.deleteField({ tableId: tableAId, fieldId: sourceDateFieldId });
      if (recBId) {
        await ctx.deleteRecords(tableBId, [recBId]);
      }
      if (recAId) {
        await ctx.deleteRecords(tableAId, [recAId]);
      }
    }
  });

  test('[V1 PARITY] should keep decimal formatting when target number converts to text in lookup chain', async () => {
    const sourceNumberFieldId = createFieldId();
    const lookupFieldId = createFieldId();
    const formulaFieldId = createFieldId();
    let recAId: string | undefined;
    let recBId: string | undefined;

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableAId,
      field: {
        type: 'number',
        id: sourceNumberFieldId,
        name: 'Lookup Source Number',
        options: {
          formatting: {
            type: 'decimal',
            precision: 2,
          },
        },
      },
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Number Lookup',
        options: {
          linkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: sourceNumberFieldId,
        },
      },
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Lookup Formula',
        options: {
          expression: `{${lookupFieldId}}`,
        },
      },
    });

    try {
      const recA = await ctx.createRecord(tableAId, {
        [aPrimaryFieldId]: 'AmountRow',
        [sourceNumberFieldId]: 1,
      });
      recAId = recA.id;

      const recB = await ctx.createRecord(tableBId, {
        [bPrimaryFieldId]: 'NumberLookupHost',
        [linkFieldId]: { id: recA.id },
      });
      recBId = recB.id;

      await ctx.drainOutbox();

      await ctx.updateField({
        tableId: tableAId,
        fieldId: sourceNumberFieldId,
        field: { type: 'singleLineText' },
      });

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecordsWithoutDrain(tableBId);
      const hostRecord = hostRecords.find((r) => r.id === recB.id);
      expect(hostRecord?.fields[lookupFieldId]).toEqual(['1.00']);
      const formulaValue = hostRecord?.fields[formulaFieldId];
      if (Array.isArray(formulaValue)) {
        expect(formulaValue).toEqual(['1.00']);
      } else {
        expect(formulaValue).toBe('1.00');
      }
    } finally {
      await ctx.deleteField({ tableId: tableBId, fieldId: formulaFieldId });
      await ctx.deleteField({ tableId: tableBId, fieldId: lookupFieldId });
      await ctx.deleteField({ tableId: tableAId, fieldId: sourceNumberFieldId });
      if (recBId) {
        await ctx.deleteRecords(tableBId, [recBId]);
      }
      if (recAId) {
        await ctx.deleteRecords(tableAId, [recAId]);
      }
    }
  });

  // ============ Rollup config/expression change → cascade ============

  test('should recompute rollup when rollup expression changes', async () => {
    const recA1 = await ctx.createRecord(tableAId, {
      [aPrimaryFieldId]: 'ExprRow1',
      [aAmountFieldId]: 10,
    });
    const recA2 = await ctx.createRecord(tableAId, {
      [aPrimaryFieldId]: 'ExprRow2',
      [aAmountFieldId]: 20,
    });

    // Create rollup with SUM
    const rollupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'rollup',
        id: rollupFieldId,
        name: 'Agg Amount',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: aAmountFieldId,
        },
      },
    });

    const recB = await ctx.createRecord(tableBId, {
      [bPrimaryFieldId]: 'ExprHost',
      [linkFieldId]: { id: recA1.id },
    });

    await ctx.drainOutbox();

    // Verify initial rollup = 10 (linked to recA1 only)
    let bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    let bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[rollupFieldId]).toBe(10);

    // Action: Change expression from SUM to count
    await ctx.updateField({
      tableId: tableBId,
      fieldId: rollupFieldId,
      field: {
        options: { expression: 'count({values})' },
      },
    });

    await ctx.drainOutbox();

    // Assert: Rollup self-backfills with count (1 linked record)
    bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[rollupFieldId]).toBe(1);

    // Cleanup
    await ctx.deleteField({ tableId: tableBId, fieldId: rollupFieldId });
    await ctx.deleteRecords(tableBId, [recB.id]);
    await ctx.deleteRecords(tableAId, [recA1.id, recA2.id]);
  });

  test('should recompute rollup when lookupFieldId changes', async () => {
    const recA = await ctx.createRecord(tableAId, {
      [aPrimaryFieldId]: 'ConfigRow',
      [aAmountFieldId]: 100,
      [aQuantityFieldId]: 5,
    });

    // Create rollup looking up Amount
    const rollupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tableBId,
      field: {
        type: 'rollup',
        id: rollupFieldId,
        name: 'Sum Field',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId,
          foreignTableId: tableAId,
          lookupFieldId: aAmountFieldId,
        },
      },
    });

    const recB = await ctx.createRecord(tableBId, {
      [bPrimaryFieldId]: 'ConfigHost',
      [linkFieldId]: { id: recA.id },
    });

    await ctx.drainOutbox();

    // Verify initial rollup = 100 (sum of Amount)
    let bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    let bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[rollupFieldId]).toBe(100);

    // Action: Change rollup config to look up Quantity instead of Amount
    await ctx.updateField({
      tableId: tableBId,
      fieldId: rollupFieldId,
      field: {
        options: { expression: 'sum({values})' },
        config: { linkFieldId, foreignTableId: tableAId, lookupFieldId: aQuantityFieldId },
      },
    });

    await ctx.drainOutbox();

    // Assert: Rollup self-backfills with Quantity value
    bRecords = await ctx.listRecordsWithoutDrain(tableBId);
    bRec = bRecords.find((r) => r.id === recB.id);
    expect(bRec?.fields[rollupFieldId]).toBe(5);

    // Cleanup
    await ctx.deleteField({ tableId: tableBId, fieldId: rollupFieldId });
    await ctx.deleteRecords(tableBId, [recB.id]);
    await ctx.deleteRecords(tableAId, [recA.id]);
  });
});

describe('update-field: cascade for conditionalLookup/conditionalRollup', () => {
  let ctx: SharedTestContext;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;
  let foreignStatusFieldId: string;
  let foreignAmountFieldId: string;
  let hostTableId: string;
  let hostPrimaryFieldId: string;
  let hostFilterFieldId: string;

  const statusActive = { id: 'choActive', name: 'Active', color: 'greenBright' as const };
  const statusClosed = { id: 'choClosed', name: 'Closed', color: 'redBright' as const };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create foreign table with Status (select), Amount (number)
    foreignPrimaryFieldId = createFieldId();
    foreignStatusFieldId = createFieldId();
    foreignAmountFieldId = createFieldId();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'CondCascade Foreign',
      fields: [
        { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
        {
          type: 'singleSelect',
          id: foreignStatusFieldId,
          name: 'Status',
          options: { choices: [statusActive, statusClosed] },
        },
        { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
      ],
    });
    foreignTableId = foreignTable.id;

    // Create host table with StatusFilter field (for isSymbol matching)
    hostPrimaryFieldId = createFieldId();
    hostFilterFieldId = createFieldId();

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'CondCascade Host',
      fields: [
        { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Label', isPrimary: true },
        { type: 'singleLineText', id: hostFilterFieldId, name: 'StatusFilter' },
      ],
    });
    hostTableId = hostTable.id;
  }, 30000);

  afterAll(async () => {
    try {
      if (hostTableId) await ctx.deleteTable(hostTableId);
    } catch {
      // ignore
    }
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {
      // ignore
    }
  });

  test('should recompute conditionalLookup when filter field option is renamed in foreign table', async () => {
    const recF1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Alpha',
      [foreignStatusFieldId]: 'Active',
      [foreignAmountFieldId]: 10,
    });
    const recF2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Beta',
      [foreignStatusFieldId]: 'Active',
      [foreignAmountFieldId]: 20,
    });
    const recF3 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Gamma',
      [foreignStatusFieldId]: 'Closed',
      [foreignAmountFieldId]: 30,
    });

    const recH = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host1',
      [hostFilterFieldId]: 'Active',
    });

    const condLookupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: condLookupFieldId,
        name: 'Filtered Names',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignStatusFieldId,
                  operator: 'is',
                  value: hostFilterFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      },
    });

    await ctx.drainOutbox();

    // Verify initial: should see Alpha and Beta (Active records)
    let hostRecords = await ctx.listRecordsWithoutDrain(hostTableId);
    let hRec = hostRecords.find((r) => r.id === recH.id);
    expect(hRec?.fields[condLookupFieldId]).toEqual(['Alpha', 'Beta']);

    try {
      // Action: Rename "Active" → "Running" in foreign table's Status field
      const statusRunning = { ...statusActive, name: 'Running' };
      await ctx.updateField({
        tableId: foreignTableId,
        fieldId: foreignStatusFieldId,
        field: { options: { choices: [statusRunning, statusClosed] } },
      });

      await ctx.drainOutbox();

      // After rename, foreign records now have "Running" instead of "Active"
      // But host.StatusFilter still says "Active" — so the filter no longer matches
      hostRecords = await ctx.listRecordsWithoutDrain(hostTableId);
      hRec = hostRecords.find((r) => r.id === recH.id);
      expect(hRec?.fields[condLookupFieldId]).toBeNull();
    } finally {
      // Always restore option name so other tests aren't affected
      await ctx.updateField({
        tableId: foreignTableId,
        fieldId: foreignStatusFieldId,
        field: { options: { choices: [statusActive, statusClosed] } },
      });

      await ctx.deleteField({ tableId: hostTableId, fieldId: condLookupFieldId });
      await ctx.deleteRecords(hostTableId, [recH.id]);
      await ctx.deleteRecords(foreignTableId, [recF1.id, recF2.id, recF3.id]);
    }
  });

  test('should recompute conditionalLookup when filter field option is removed in foreign table', async () => {
    const recF1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Item1',
      [foreignStatusFieldId]: 'Active',
      [foreignAmountFieldId]: 10,
    });
    const recF2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Item2',
      [foreignStatusFieldId]: 'Closed',
      [foreignAmountFieldId]: 20,
    });

    const recH = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'HostRemove',
      [hostFilterFieldId]: 'Closed',
    });

    const condLookupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: condLookupFieldId,
        name: 'Filtered By Status',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignStatusFieldId,
                  operator: 'is',
                  value: hostFilterFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      },
    });

    await ctx.drainOutbox();

    // Verify initial: should see Item2 (Closed)
    let hostRecords = await ctx.listRecordsWithoutDrain(hostTableId);
    let hRec = hostRecords.find((r) => r.id === recH.id);
    expect(hRec?.fields[condLookupFieldId]).toEqual(['Item2']);

    try {
      // Action: Remove "Closed" option — records with "Closed" become null
      await ctx.updateField({
        tableId: foreignTableId,
        fieldId: foreignStatusFieldId,
        field: { options: { choices: [statusActive] } },
      });

      await ctx.drainOutbox();

      // Foreign records with "Closed" now have null Status → no match
      hostRecords = await ctx.listRecordsWithoutDrain(hostTableId);
      hRec = hostRecords.find((r) => r.id === recH.id);
      expect(hRec?.fields[condLookupFieldId]).toBeNull();
    } finally {
      // Always restore options
      await ctx.updateField({
        tableId: foreignTableId,
        fieldId: foreignStatusFieldId,
        field: { options: { choices: [statusActive, statusClosed] } },
      });

      await ctx.deleteField({ tableId: hostTableId, fieldId: condLookupFieldId });
      await ctx.deleteRecords(hostTableId, [recH.id]);
      await ctx.deleteRecords(foreignTableId, [recF1.id, recF2.id]);
    }
  });

  test('should recompute conditionalRollup when filter field values change due to schema update', async () => {
    const recF1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'CR1',
      [foreignStatusFieldId]: 'Active',
      [foreignAmountFieldId]: 100,
    });
    const recF2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'CR2',
      [foreignStatusFieldId]: 'Active',
      [foreignAmountFieldId]: 200,
    });
    const recF3 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'CR3',
      [foreignStatusFieldId]: 'Closed',
      [foreignAmountFieldId]: 300,
    });

    const recH = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'RollupHost',
      [hostFilterFieldId]: 'Active',
    });

    const condRollupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: condRollupFieldId,
        name: 'Filtered Sum',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignAmountFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignStatusFieldId,
                  operator: 'is',
                  value: hostFilterFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      },
    });

    await ctx.drainOutbox();

    // Verify initial: SUM of Active amounts = 100 + 200 = 300
    let hostRecords = await ctx.listRecordsWithoutDrain(hostTableId);
    let hRec = hostRecords.find((r) => r.id === recH.id);
    expect(hRec?.fields[condRollupFieldId]).toBe(300);

    try {
      // Action: Rename "Active" → "Live" in foreign table
      const statusLive = { ...statusActive, name: 'Live' };
      await ctx.updateField({
        tableId: foreignTableId,
        fieldId: foreignStatusFieldId,
        field: { options: { choices: [statusLive, statusClosed] } },
      });

      await ctx.drainOutbox();

      // After rename, foreign Status="Live" but host filter still says "Active"
      // Filter no longer matches → rollup should be 0 or null
      hostRecords = await ctx.listRecordsWithoutDrain(hostTableId);
      hRec = hostRecords.find((r) => r.id === recH.id);
      expect(
        hRec?.fields[condRollupFieldId] === 0 || hRec?.fields[condRollupFieldId] === null
      ).toBe(true);
    } finally {
      // Always restore option name
      await ctx.updateField({
        tableId: foreignTableId,
        fieldId: foreignStatusFieldId,
        field: { options: { choices: [statusActive, statusClosed] } },
      });

      await ctx.deleteField({ tableId: hostTableId, fieldId: condRollupFieldId });
      await ctx.deleteRecords(hostTableId, [recH.id]);
      await ctx.deleteRecords(foreignTableId, [recF1.id, recF2.id, recF3.id]);
    }
  });

  test('should recompute conditionalLookup when lookupFieldId is changed via update', async () => {
    const recF1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'LookItem',
      [foreignStatusFieldId]: 'Active',
      [foreignAmountFieldId]: 42,
    });

    const recH = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'CondLookHost',
      [hostFilterFieldId]: 'Active',
    });

    const condLookupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: condLookupFieldId,
        name: 'CondLookup Config',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignStatusFieldId,
                  operator: 'is',
                  value: hostFilterFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      },
    });

    await ctx.drainOutbox();

    // Verify initial: looking up Name where Status == 'Active'
    let hostRecords = await ctx.listRecordsWithoutDrain(hostTableId);
    let hRec = hostRecords.find((r) => r.id === recH.id);
    expect(hRec?.fields[condLookupFieldId]).toEqual(['LookItem']);

    // Action: Change lookupFieldId to Amount
    await ctx.updateField({
      tableId: hostTableId,
      fieldId: condLookupFieldId,
      field: {
        options: {
          foreignTableId,
          lookupFieldId: foreignAmountFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignStatusFieldId,
                  operator: 'is',
                  value: hostFilterFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      },
    });

    await ctx.drainOutbox();

    // Assert: condLookup self-backfills with Amount values
    hostRecords = await ctx.listRecordsWithoutDrain(hostTableId);
    hRec = hostRecords.find((r) => r.id === recH.id);
    expect(hRec?.fields[condLookupFieldId]).toEqual([42]);

    // Cleanup
    await ctx.deleteField({ tableId: hostTableId, fieldId: condLookupFieldId });
    await ctx.deleteRecords(hostTableId, [recH.id]);
    await ctx.deleteRecords(foreignTableId, [recF1.id]);
  });

  test('should recompute conditionalRollup expression change with cascade to formula', async () => {
    const recF1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'ExprItem1',
      [foreignStatusFieldId]: 'Active',
      [foreignAmountFieldId]: 15,
    });
    const recF2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'ExprItem2',
      [foreignStatusFieldId]: 'Active',
      [foreignAmountFieldId]: 25,
    });

    const recH = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'ExprRollHost',
      [hostFilterFieldId]: 'Active',
    });

    const condRollupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: condRollupFieldId,
        name: 'CondRollup Expr',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignAmountFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignStatusFieldId,
                  operator: 'is',
                  value: hostFilterFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      },
    });

    // Create formula depending on the condRollup
    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Rollup Double',
        options: { expression: `{${condRollupFieldId}} * 2` },
      },
    });

    await ctx.drainOutbox();

    // Verify initial: SUM(15, 25) = 40, formula = 80
    let hostRecords = await ctx.listRecordsWithoutDrain(hostTableId);
    let hRec = hostRecords.find((r) => r.id === recH.id);
    expect(hRec?.fields[condRollupFieldId]).toBe(40);
    expect(hRec?.fields[formulaFieldId]).toBe(80);

    // Action: Change condRollup expression from sum to count
    await ctx.updateField({
      tableId: hostTableId,
      fieldId: condRollupFieldId,
      field: {
        options: {
          expression: 'count({values})',
          timeZone: 'utc',
        },
      },
    });

    await ctx.drainOutbox();

    // Assert: condRollup self-backfills with count(2), formula cascades
    hostRecords = await ctx.listRecordsWithoutDrain(hostTableId);
    hRec = hostRecords.find((r) => r.id === recH.id);
    expect(hRec?.fields[condRollupFieldId]).toBe(2);
    expect(hRec?.fields[formulaFieldId]).toBe(4);

    // Cleanup
    await ctx.deleteField({ tableId: hostTableId, fieldId: formulaFieldId });
    await ctx.deleteField({ tableId: hostTableId, fieldId: condRollupFieldId });
    await ctx.deleteRecords(hostTableId, [recH.id]);
    await ctx.deleteRecords(foreignTableId, [recF1.id, recF2.id]);
  });
});
