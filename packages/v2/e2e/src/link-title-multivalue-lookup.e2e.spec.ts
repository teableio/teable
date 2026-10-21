/* eslint-disable @typescript-eslint/naming-convention */
import { describe, beforeAll, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('[F11] v2 link field title with multi-value lookup (e2e)', () => {
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
    const table2Records = await ctx.listRecordsWithoutDrain(table2.id);
    const linkValue = table2Records[0].fields[linkFieldId];

    expect(linkValue).toEqual([
      {
        id: table1Rec1.id,
        title: 'table1_1', // CRITICAL: title should be present
      },
    ]);

    // Also check the symmetric field on Table1
    const table1Records = await ctx.listRecordsWithoutDrain(table1.id);
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

  it('should include a multi-value formula title and refresh it when source values change', async () => {
    const multiSelectFieldId = createFieldId();
    const formulaFieldId = createFieldId();
    const hostTitleFieldId = createFieldId();
    const linkFieldId = createFieldId();

    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'MultiValueTitleForeign',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'multipleSelect',
          id: multiSelectFieldId,
          name: 'Tags',
          options: { choices: [{ name: 'Granite' }, { name: 'Basalt' }, { name: 'Quartz' }] },
        },
        {
          type: 'formula',
          id: formulaFieldId,
          name: 'Tag Label',
          options: { expression: `{${multiSelectFieldId}}` },
        },
      ],
      records: [{ fields: { Name: 'Rock', [multiSelectFieldId]: ['Granite', 'Basalt'] } }],
    });

    const foreignRecord = (await ctx.listRecords(foreign.id))[0];
    if (!foreignRecord) throw new Error('Missing foreign record');

    // The link display field must stay multi-value, otherwise this case would
    // silently stop covering the multi-value formula title path.
    const displayField = (await ctx.getTableById(foreign.id)).fields.find(
      (field) => field.id === formulaFieldId
    );
    expect(displayField?.isMultipleCellValue).toBe(true);

    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'MultiValueTitleHost',
      fields: [
        { type: 'singleLineText', id: hostTitleFieldId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Rocks',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreign.id,
            lookupFieldId: formulaFieldId,
          },
        },
      ],
    });

    const hostRecord = await ctx.createRecord(host.id, {
      [hostTitleFieldId]: 'Host',
      [linkFieldId]: { id: foreignRecord.id },
    });
    await ctx.drainOutbox();

    const readLinkTitle = async () => {
      const records = await ctx.listRecords(host.id);
      const record = records.find((item) => item.id === hostRecord.id);
      const value = record?.fields[linkFieldId] as { id: string; title?: string } | undefined;
      return value;
    };

    const linkValue = await readLinkTitle();
    expect(linkValue).toMatchObject({ id: foreignRecord.id });
    const initialTitle = linkValue?.title ?? '';
    expect(initialTitle).toContain('Granite');
    expect(initialTitle).toContain('Basalt');

    // Changing the source values must refresh the stored link title.
    await ctx.updateRecord(foreign.id, foreignRecord.id, {
      [multiSelectFieldId]: ['Basalt', 'Quartz'],
    });
    await ctx.drainOutbox();

    const refreshedTitle = (await readLinkTitle())?.title ?? '';
    expect(refreshedTitle).toContain('Quartz');
    expect(refreshedTitle).not.toContain('Granite');
  });
});
