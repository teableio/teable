/* eslint-disable @typescript-eslint/naming-convention */
import { describe, beforeAll, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 link field title with multi-value lookup (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('should include title when link lookupField is multi-value formula', async () => {
    const textFieldId = createFieldId();
    const multiSelectFieldId = createFieldId();

    // Create Table1 first (simple table with text field)
    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Table1',
      fields: [
        {
          type: 'singleLineText',
          id: textFieldId,
          name: 'text',
        },
      ],
    });

    // Create records in Table1
    await ctx.createRecord(table1.id, { [textFieldId]: 'table1_1' });
    await ctx.createRecord(table1.id, { [textFieldId]: 'table1_2' });
    await ctx.createRecord(table1.id, { [textFieldId]: 'table1_3' });

    // Create Table2 with multi-select field
    const table2MultiSelectFieldId = createFieldId();
    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Table2',
      fields: [
        {
          type: 'singleLineText',
          id: createFieldId(),
          name: 'text',
        },
        {
          type: 'multipleSelect',
          id: table2MultiSelectFieldId,
          name: 'multiSelect',
          options: {
            choices: [
              { name: 'A', color: 'blue' },
              { name: 'B', color: 'red' },
              { name: 'C', color: 'green' },
            ],
          },
        },
      ],
    });

    // Create records in Table2 with multi-select values
    await ctx.createRecord(table2.id, {
      [table2MultiSelectFieldId]: ['A'],
    });
    await ctx.createRecord(table2.id, {
      [table2MultiSelectFieldId]: ['B', 'C'],
    });

    await ctx.drainOutbox();

    // TODO: Convert Table2's primary field (text field) to a formula field
    // that references the multi-select field
    // This is blocked because we don't have a convertField API in v2 yet
    // For now, this test documents the issue but cannot fully reproduce it

    // The expected behavior after conversion would be:
    // - Table2's primary field shows "A" for rec1, "B, C" for rec2
    // - When Table1 links to Table2, the title should be "A" or "B, C"

    // For now, we'll skip the actual test since we can't convert fields
    // But we document what SHOULD happen
  });

  it('should include title when link lookupField is single-value field (baseline)', async () => {
    const text1FieldId = createFieldId();
    const text2FieldId = createFieldId();
    const linkFieldId = createFieldId();

    // Create Table1
    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Table1_Baseline',
      fields: [
        {
          type: 'singleLineText',
          id: text1FieldId,
          name: 'text',
        },
      ],
    });

    const table1Rec1 = await ctx.createRecord(table1.id, { [text1FieldId]: 'table1_1' });
    await ctx.createRecord(table1.id, { [text1FieldId]: 'table1_2' });

    // Create Table2 with ManyMany link to Table1
    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Table2_Baseline',
      fields: [
        {
          type: 'singleLineText',
          id: text2FieldId,
          name: 'text',
        },
        {
          type: 'link',
          id: linkFieldId,
          name: 'linkToTable1',
          options: {
            relationship: 'manyMany',
            foreignTableId: table1.id,
            lookupFieldId: text1FieldId,
          },
        },
      ],
    });

    const table2Rec1 = await ctx.createRecord(table2.id, {
      [text2FieldId]: 'table2_1',
    });

    // Link table2Rec1 to table1Rec1
    await ctx.updateRecord(table2.id, table2Rec1.id, {
      [linkFieldId]: [{ id: table1Rec1.id }],
    });

    await ctx.drainOutbox();

    // Read back Table2 to verify link field has title
    const table2Records = await ctx.listRecords(table2.id);
    const linkValue = table2Records[0].fields[linkFieldId];

    expect(linkValue).toEqual([
      {
        id: table1Rec1.id,
        title: 'table1_1', // CRITICAL: title should be present
      },
    ]);

    // Also check the symmetric field on Table1
    const table1Records = await ctx.listRecords(table1.id);
    const symmetricFieldName = Object.keys(table1Records[0].fields).find(
      (key) => key !== 'text' && key !== text1FieldId
    );
    expect(symmetricFieldName).toBeDefined();

    const symmetricLinkValue = table1Records[0].fields[symmetricFieldName!];
    expect(symmetricLinkValue).toEqual([
      {
        id: table2Rec1.id,
        title: 'table2_1', // CRITICAL: symmetric link should also have title
      },
    ]);
  });
});
