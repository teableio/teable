/* eslint-disable @typescript-eslint/naming-convention */
/**
 * E2E tests for formula field CRUD backfill semantics.
 *
 * Ported from v1 spec: apps/nestjs-backend/test/formula-field.e2e-spec.ts.
 * Unlike formula.e2e.spec.ts (formula evaluation on insert/update), these
 * cases create the formula field AFTER records exist and assert the computed
 * backfill of existing rows, plus formula recalculation contracts on record
 * creation with omitted/blank references.
 *
 * Also ports:
 * - apps/nestjs-backend/test/formula-conditional-numeric-cast-regression.e2e-spec.ts
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type RecordShape = { id: string; fields: Record<string, unknown> };

describe('v2 formula field CRUD backfill (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = `frmcrud${fieldIdCounter.toString(36)}`.padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const drainOutbox = async (maxRounds = 10) => {
    for (let i = 0; i < maxRounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listRecords = async (tableId: string): Promise<RecordShape[]> => {
    await drainOutbox();
    return ctx.listRecords(tableId);
  };

  const getRecord = async (tableId: string, recordId: string): Promise<RecordShape> => {
    const records = await listRecords(tableId);
    const record = records.find((item) => item.id === recordId);
    if (!record) throw new Error(`Record not found: ${recordId}`);
    return record;
  };

  const createFormulaField = async (tableId: string, name: string, expression: string) => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'formula', id: fieldId, name, options: { expression } },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // create formula field (backfills existing records)
  // ---------------------------------------------------------------------------

  describe('create formula field backfills existing records', () => {
    const setupBaseTable = async () => {
      const textFieldId = createFieldId();
      const numberFieldId = createFieldId();
      const dateFieldId = createFieldId();
      const ratingFieldId = createFieldId();
      const checkboxFieldId = createFieldId();
      const selectFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Formula CRUD Base'),
        fields: [
          { type: 'singleLineText', id: textFieldId, name: 'Text Field', isPrimary: true },
          {
            type: 'number',
            id: numberFieldId,
            name: 'Number Field',
            options: { formatting: { type: 'decimal', precision: 2 } },
          },
          { type: 'date', id: dateFieldId, name: 'Date Field' },
          {
            type: 'rating',
            id: ratingFieldId,
            name: 'Rating Field',
            options: { icon: 'star', max: 5, color: 'yellowBright' },
          },
          { type: 'checkbox', id: checkboxFieldId, name: 'Checkbox Field' },
          {
            type: 'singleSelect',
            id: selectFieldId,
            name: 'Select Field',
            options: {
              choices: [
                { name: 'Option A', color: 'blue' },
                { name: 'Option B', color: 'red' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const record1 = await ctx.createRecord(table.id, {
        [textFieldId]: 'Hello World',
        [numberFieldId]: 42.5,
        [dateFieldId]: '2024-01-15T00:00:00.000Z',
        [ratingFieldId]: 4,
        [checkboxFieldId]: true,
        [selectFieldId]: 'Option A',
      });
      const record2 = await ctx.createRecord(table.id, {
        [textFieldId]: 'Test String',
        [numberFieldId]: 100,
        [dateFieldId]: '2024-02-20T00:00:00.000Z',
        [ratingFieldId]: 3,
        [checkboxFieldId]: false,
        [selectFieldId]: 'Option B',
      });

      return {
        table,
        textFieldId,
        numberFieldId,
        dateFieldId,
        ratingFieldId,
        checkboxFieldId,
        selectFieldId,
        record1,
        record2,
      };
    };

    it('backfills formula referencing text field', async () => {
      const { table, textFieldId, record1, record2 } = await setupBaseTable();
      const formulaFieldId = await createFormulaField(
        table.id,
        'Text Formula',
        `UPPER({${textFieldId}})`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[formulaFieldId]).toBe('HELLO WORLD');
      expect(records.find((r) => r.id === record2.id)?.fields[formulaFieldId]).toBe('TEST STRING');
    });

    it('backfills formula referencing number field', async () => {
      const { table, numberFieldId, record1, record2 } = await setupBaseTable();
      const formulaFieldId = await createFormulaField(
        table.id,
        'Number Formula',
        `{${numberFieldId}} * 2`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[formulaFieldId]).toBe(85);
      expect(records.find((r) => r.id === record2.id)?.fields[formulaFieldId]).toBe(200);
    });

    it('backfills formula referencing date field', async () => {
      const { table, dateFieldId, record1, record2 } = await setupBaseTable();
      const formulaFieldId = await createFormulaField(
        table.id,
        'Date Formula',
        `YEAR({${dateFieldId}})`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[formulaFieldId]).toBe(2024);
      expect(records.find((r) => r.id === record2.id)?.fields[formulaFieldId]).toBe(2024);
    });

    it('backfills formula referencing rating field', async () => {
      const { table, ratingFieldId, record1, record2 } = await setupBaseTable();
      const formulaFieldId = await createFormulaField(
        table.id,
        'Rating Formula',
        `{${ratingFieldId}} + 1`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[formulaFieldId]).toBe(5);
      expect(records.find((r) => r.id === record2.id)?.fields[formulaFieldId]).toBe(4);
    });

    it('backfills formula referencing checkbox field', async () => {
      const { table, checkboxFieldId, record1, record2 } = await setupBaseTable();
      const formulaFieldId = await createFormulaField(
        table.id,
        'Checkbox Formula',
        `IF({${checkboxFieldId}}, "Yes", "No")`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[formulaFieldId]).toBe('Yes');
      expect(records.find((r) => r.id === record2.id)?.fields[formulaFieldId]).toBe('No');
    });

    it('backfills formula referencing select field', async () => {
      const { table, selectFieldId, record1, record2 } = await setupBaseTable();
      const formulaFieldId = await createFormulaField(
        table.id,
        'Select Formula',
        `CONCATENATE("Selected: ", {${selectFieldId}})`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[formulaFieldId]).toBe(
        'Selected: Option A'
      );
      expect(records.find((r) => r.id === record2.id)?.fields[formulaFieldId]).toBe(
        'Selected: Option B'
      );
    });

    it('substitutes numeric field as text', async () => {
      const { table, numberFieldId, record1, record2 } = await setupBaseTable();
      const formulaFieldId = await createFormulaField(
        table.id,
        'Number Substitute',
        `SUBSTITUTE({${numberFieldId}}, "0", "X")`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[formulaFieldId]).toBe('42.5');
      expect(records.find((r) => r.id === record2.id)?.fields[formulaFieldId]).toBe('1XX');
    });

    it('backfills formula with multiple field references', async () => {
      const { table, textFieldId, numberFieldId, record1, record2 } = await setupBaseTable();
      const formulaFieldId = await createFormulaField(
        table.id,
        'Multi Field Formula',
        `CONCATENATE({${textFieldId}}, " - ", {${numberFieldId}})`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[formulaFieldId]).toBe(
        'Hello World - 42.5'
      );
      expect(records.find((r) => r.id === record2.id)?.fields[formulaFieldId]).toBe(
        'Test String - 100'
      );
    });

    it('backfills boolean overdue formula using CREATED_TIME DATE_ADD without btrim(timestamptz)', async () => {
      const statusFieldId = createFieldId();
      const hoursFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Overdue Formula Backfill'),
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'singleSelect',
            id: statusFieldId,
            name: 'Status',
            options: {
              choices: [
                { name: 'Open', color: 'blueBright' },
                { name: 'Completed', color: 'greenBright' },
                { name: 'Cancelled', color: 'orangeBright' },
              ],
            },
          },
          {
            type: 'number',
            id: hoursFieldId,
            name: 'SlaHours',
            options: { formatting: { type: 'decimal', precision: 0 } },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const openRecord = await ctx.createRecord(table.id, {
        Title: 'Open request',
        [statusFieldId]: 'Open',
        [hoursFieldId]: 1,
      });
      const doneRecord = await ctx.createRecord(table.id, {
        Title: 'Completed request',
        [statusFieldId]: 'Completed',
        [hoursFieldId]: 1,
      });

      const formulaFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'formula',
          id: formulaFieldId,
          name: 'Overdue',
          options: {
            expression: `IF(OR({${statusFieldId}} = "Completed",{${statusFieldId}} = "Cancelled"), false, IF({${hoursFieldId}} > 0, IF(IS_AFTER(NOW(), DATE_ADD(CREATED_TIME(), {${hoursFieldId}}, "hours")), true, false), false))`,
            timeZone: 'utc',
          },
        },
      });

      const fallbackLogs = ctx.testContainer.spyLogger.getEntriesByMessage(
        'computed:backfillMany:sync_failed_enqueue_fallback'
      );
      const backfillErrors = fallbackLogs.filter((entry) => {
        const context = entry.context;
        return (
          typeof context === 'object' &&
          context !== null &&
          'error' in context &&
          String((context as { error?: unknown }).error).includes('btrim')
        );
      });
      expect(backfillErrors).toEqual([]);

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === openRecord.id)?.fields[formulaFieldId]).toBe(false);
      expect(records.find((r) => r.id === doneRecord.id)?.fields[formulaFieldId]).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // create formula referencing formula
  // ---------------------------------------------------------------------------

  describe('create formula referencing formula', () => {
    const setupNestedTable = async () => {
      const numberFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Nested Formula'),
        fields: [{ type: 'number', id: numberFieldId, name: 'Number Field', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const record1 = await ctx.createRecord(table.id, { [numberFieldId]: 10 });
      const record2 = await ctx.createRecord(table.id, { [numberFieldId]: 20 });
      const baseFormulaFieldId = await createFormulaField(
        table.id,
        'Base Formula',
        `{${numberFieldId}} * 2`
      );
      return { table, numberFieldId, baseFormulaFieldId, record1, record2 };
    };

    it('backfills formula referencing another formula', async () => {
      const { table, baseFormulaFieldId, record1, record2 } = await setupNestedTable();
      const nestedFormulaFieldId = await createFormulaField(
        table.id,
        'Nested Formula',
        `{${baseFormulaFieldId}} + 5`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[nestedFormulaFieldId]).toBe(25);
      expect(records.find((r) => r.id === record2.id)?.fields[nestedFormulaFieldId]).toBe(45);
    });

    it('backfills complex nested formula comparing formula to base field', async () => {
      const { table, numberFieldId, baseFormulaFieldId, record1, record2 } =
        await setupNestedTable();
      const complexFormulaFieldId = await createFormulaField(
        table.id,
        'Complex Formula',
        `IF({${baseFormulaFieldId}} > {${numberFieldId}}, "Greater", "Not Greater")`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[complexFormulaFieldId]).toBe(
        'Greater'
      );
      expect(records.find((r) => r.id === record2.id)?.fields[complexFormulaFieldId]).toBe(
        'Greater'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // create formula with link, lookup and rollup fields
  // ---------------------------------------------------------------------------

  describe('create formula with link, lookup and rollup fields', () => {
    const setupLinkedTables = async () => {
      const foreignTitleFieldId = createFieldId();
      const foreignValueFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Formula CRUD Related'),
        fields: [
          { type: 'singleLineText', id: foreignTitleFieldId, name: 'Title', isPrimary: true },
          { type: 'number', id: foreignValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });
      const foreignRecord1 = await ctx.createRecord(foreignTable.id, {
        [foreignTitleFieldId]: 'Item A',
        [foreignValueFieldId]: 100,
      });
      const foreignRecord2 = await ctx.createRecord(foreignTable.id, {
        [foreignTitleFieldId]: 'Item B',
        [foreignValueFieldId]: 200,
      });

      const mainNameFieldId = createFieldId();
      const linkFieldId = createFieldId();
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Formula CRUD Main'),
        fields: [
          { type: 'singleLineText', id: mainNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: linkFieldId,
            name: 'Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignTitleFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const mainRecord1 = await ctx.createRecord(mainTable.id, {
        [mainNameFieldId]: 'Record 1',
        [linkFieldId]: { id: foreignRecord1.id },
      });
      const mainRecord2 = await ctx.createRecord(mainTable.id, {
        [mainNameFieldId]: 'Record 2',
        [linkFieldId]: { id: foreignRecord2.id },
      });

      const lookupFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: mainTable.id,
        field: {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Lookup Title',
          options: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignTitleFieldId,
          },
        },
      });

      const rollupFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: mainTable.id,
        field: {
          type: 'rollup',
          id: rollupFieldId,
          name: 'Rollup Value',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignValueFieldId,
          },
        },
      });

      await drainOutbox();

      return {
        mainTable,
        foreignTable,
        mainNameFieldId,
        linkFieldId,
        lookupFieldId,
        rollupFieldId,
        mainRecord1,
        mainRecord2,
      };
    };

    it('backfills formula referencing lookup field', async () => {
      const { mainTable, lookupFieldId, mainRecord1, mainRecord2 } = await setupLinkedTables();
      const formulaFieldId = await createFormulaField(
        mainTable.id,
        'Lookup Formula',
        `{${lookupFieldId}}`
      );

      const records = await listRecords(mainTable.id);
      const first = records.find((r) => r.id === mainRecord1.id);
      const second = records.find((r) => r.id === mainRecord2.id);
      expect(JSON.stringify(first?.fields[formulaFieldId])).toContain('Item A');
      expect(JSON.stringify(second?.fields[formulaFieldId])).toContain('Item B');
    });

    it('backfills formula referencing rollup field', async () => {
      const { mainTable, rollupFieldId, mainRecord1, mainRecord2 } = await setupLinkedTables();
      const formulaFieldId = await createFormulaField(
        mainTable.id,
        'Rollup Formula',
        `{${rollupFieldId}} * 2`
      );

      const records = await listRecords(mainTable.id);
      expect(records.find((r) => r.id === mainRecord1.id)?.fields[formulaFieldId]).toBe(200);
      expect(records.find((r) => r.id === mainRecord2.id)?.fields[formulaFieldId]).toBe(400);
    });

    // Regression (T6520): inserts treat all table fields as changed, so
    // referenced formulas compute even for records created with zero fields.
    it('falls back when rollup-based formula has no linked data', async () => {
      const { mainTable, rollupFieldId } = await setupLinkedTables();
      const formulaFieldId = await createFormulaField(
        mainTable.id,
        'Rollup Fallback',
        `IF({${rollupFieldId}} > 0, "Has rollup", "No rollup")`
      );

      const created = await ctx.createRecord(mainTable.id, {});
      const record = await getRecord(mainTable.id, created.id);
      expect(record.fields[formulaFieldId]).toBe('No rollup');
    });

    it('backfills formula referencing link field', async () => {
      const { mainTable, linkFieldId, mainRecord1, mainRecord2 } = await setupLinkedTables();
      const formulaFieldId = await createFormulaField(
        mainTable.id,
        'Link Formula',
        `IF({${linkFieldId}}, "Has Link", "No Link")`
      );

      const records = await listRecords(mainTable.id);
      expect(records.find((r) => r.id === mainRecord1.id)?.fields[formulaFieldId]).toBe('Has Link');
      expect(records.find((r) => r.id === mainRecord2.id)?.fields[formulaFieldId]).toBe('Has Link');
    });

    it('creates formula that indirectly references link field through another formula', async () => {
      const { mainTable, linkFieldId, mainRecord1, mainRecord2 } = await setupLinkedTables();
      const formula2Id = await createFormulaField(
        mainTable.id,
        'Formula 2',
        `IF({${linkFieldId}}, "Has Link", "No Link")`
      );
      const formula1Id = await createFormulaField(
        mainTable.id,
        'Formula 1',
        `CONCATENATE("Result: ", {${formula2Id}})`
      );

      const records = await listRecords(mainTable.id);
      expect(records.find((r) => r.id === mainRecord1.id)?.fields[formula1Id]).toBe(
        'Result: Has Link'
      );
      expect(records.find((r) => r.id === mainRecord2.id)?.fields[formula1Id]).toBe(
        'Result: Has Link'
      );
    });

    it('creates formula that indirectly references lookup field through another formula', async () => {
      const { mainTable, lookupFieldId, mainRecord1, mainRecord2 } = await setupLinkedTables();
      const formula2Id = await createFormulaField(
        mainTable.id,
        'Formula 2',
        `CONCATENATE("Lookup: ", {${lookupFieldId}})`
      );
      const formula1Id = await createFormulaField(
        mainTable.id,
        'Formula 1',
        `UPPER({${formula2Id}})`
      );

      const records = await listRecords(mainTable.id);
      expect(records.find((r) => r.id === mainRecord1.id)?.fields[formula1Id]).toBe(
        'LOOKUP: ITEM A'
      );
      expect(records.find((r) => r.id === mainRecord2.id)?.fields[formula1Id]).toBe(
        'LOOKUP: ITEM B'
      );
    });

    it('creates formula that indirectly references rollup field through another formula', async () => {
      const { mainTable, rollupFieldId, mainRecord1, mainRecord2 } = await setupLinkedTables();
      const formula2Id = await createFormulaField(
        mainTable.id,
        'Formula 2',
        `{${rollupFieldId}} * 2`
      );
      const formula1Id = await createFormulaField(
        mainTable.id,
        'Formula 1',
        `{${formula2Id}} + 10`
      );

      const records = await listRecords(mainTable.id);
      expect(records.find((r) => r.id === mainRecord1.id)?.fields[formula1Id]).toBe(210);
      expect(records.find((r) => r.id === mainRecord2.id)?.fields[formula1Id]).toBe(410);
    });

    it('creates multi-level formula chain rooted at a rollup field', async () => {
      const { mainTable, rollupFieldId, mainRecord1, mainRecord2 } = await setupLinkedTables();
      const formula3Id = await createFormulaField(mainTable.id, 'Formula 3', `{${rollupFieldId}}`);
      const formula2Id = await createFormulaField(mainTable.id, 'Formula 2', `{${formula3Id}} * 2`);
      const formula1Id = await createFormulaField(mainTable.id, 'Formula 1', `{${formula2Id}} + 5`);

      const records = await listRecords(mainTable.id);
      expect(records.find((r) => r.id === mainRecord1.id)?.fields[formula1Id]).toBe(205);
      expect(records.find((r) => r.id === mainRecord2.id)?.fields[formula1Id]).toBe(405);
    });

    // T6767: sanitized, structure-equivalent to production table.update backfill.
    // Retained facts: manyOne host, lookup of a foreign link field stored in a
    // leftover TEXT column, formula `{lookup}` created after rows exist.
    it('backfills formula over a text-stored lookup-of-link without json syntax errors', async () => {
      const foreignTitleFieldId = createFieldId();
      const foreignLinkFieldId = createFieldId();
      const peerTitleFieldId = createFieldId();
      const peerTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Formula Probe Peer'),
        fields: [
          { type: 'singleLineText', id: peerTitleFieldId, name: 'Peer Title', isPrimary: true },
        ],
        views: [{ type: 'grid' }],
      });
      const peerRecord = await ctx.createRecord(peerTable.id, {
        [peerTitleFieldId]: 'Peer A',
      });

      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Formula Probe Foreign'),
        fields: [
          { type: 'singleLineText', id: foreignTitleFieldId, name: 'Title', isPrimary: true },
          {
            type: 'link',
            id: foreignLinkFieldId,
            name: 'Peer Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: peerTable.id,
              lookupFieldId: peerTitleFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const foreignRecord = await ctx.createRecord(foreignTable.id, {
        [foreignTitleFieldId]: 'Item A',
        [foreignLinkFieldId]: { id: peerRecord.id },
      });

      const hostNameFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const lookupOfLinkFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Formula Probe Host'),
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: lookupOfLinkFieldId, name: 'Foreign Peer' },
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Foreign Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignTitleFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host 1',
        [hostLinkFieldId]: { id: foreignRecord.id },
      });

      await ctx.updateField({
        tableId: hostTable.id,
        fieldId: lookupOfLinkFieldId,
        field: {
          type: 'lookup',
          options: {
            linkFieldId: hostLinkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignLinkFieldId,
          },
        },
      });
      await drainOutbox();

      const scalarFormulaId = await createFormulaField(
        hostTable.id,
        'Scalar Probe',
        `{${lookupOfLinkFieldId}}`
      );

      const record = await getRecord(hostTable.id, hostRecord.id);
      expect(JSON.stringify(record.fields[scalarFormulaId])).toContain('Peer A');
    });
  });

  // ---------------------------------------------------------------------------
  // formula recalculation on record creation
  // ---------------------------------------------------------------------------

  describe('formula recalculation on record creation', () => {
    const setupStatusTable = async () => {
      const nameFieldId = createFieldId();
      const statusFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Formula Status'),
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: statusFieldId, name: 'Status' },
        ],
        views: [{ type: 'grid' }],
      });
      const statusFormulaFieldId = await createFormulaField(
        table.id,
        'Status Formula',
        `IF({${statusFieldId}}="", 1, 222222)`
      );
      return { table, nameFieldId, statusFieldId, statusFormulaFieldId };
    };

    it('calculates formula when referenced field is omitted on creation', async () => {
      const { table, nameFieldId, statusFieldId, statusFormulaFieldId } = await setupStatusTable();
      const created = await ctx.createRecord(table.id, { [nameFieldId]: 'Missing status' });

      const record = await getRecord(table.id, created.id);
      expect(record.fields[statusFieldId] ?? null).toBeNull();
      expect(record.fields[statusFormulaFieldId]).toBe(1);
    });

    it('calculates alternate branch when referenced field has value', async () => {
      const { table, nameFieldId, statusFieldId, statusFormulaFieldId } = await setupStatusTable();
      const created = await ctx.createRecord(table.id, {
        [nameFieldId]: 'Has status',
        [statusFieldId]: 'done',
      });

      const record = await getRecord(table.id, created.id);
      expect(record.fields[statusFormulaFieldId]).toBe(222222);
    });
  });

  // ---------------------------------------------------------------------------
  // formula recalculation referencing lookup dependencies
  // ---------------------------------------------------------------------------

  describe('formula recalculation referencing lookup dependencies', () => {
    const setupLookupFormulaTables = async () => {
      const foreignTitleFieldId = createFieldId();
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Lookup Source'),
        fields: [
          { type: 'singleLineText', id: foreignTitleFieldId, name: 'Title', isPrimary: true },
        ],
        views: [{ type: 'grid' }],
      });
      const itemA = await ctx.createRecord(foreignTable.id, { [foreignTitleFieldId]: 'Item A' });
      await ctx.createRecord(foreignTable.id, { [foreignTitleFieldId]: 'Item B' });

      const nameFieldId = createFieldId();
      const linkFieldId = createFieldId();
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Lookup Host'),
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: linkFieldId,
            name: 'Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignTitleFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const lookupFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: mainTable.id,
        field: {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Lookup Title',
          options: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignTitleFieldId,
          },
        },
      });

      const formulaFieldId = await createFormulaField(
        mainTable.id,
        'Lookup Formula',
        `IF({${lookupFieldId}}="", "no lookup", {${lookupFieldId}})`
      );

      return { mainTable, nameFieldId, linkFieldId, lookupFieldId, formulaFieldId, itemA };
    };

    it('computes lookup-based formula when link is omitted on creation', async () => {
      const { mainTable, nameFieldId, formulaFieldId } = await setupLookupFormulaTables();
      const created = await ctx.createRecord(mainTable.id, { [nameFieldId]: 'No link' });

      const record = await getRecord(mainTable.id, created.id);
      expect(record.fields[formulaFieldId]).toBe('no lookup');
    });

    it('computes lookup-based formula when link is provided on creation', async () => {
      const { mainTable, nameFieldId, linkFieldId, lookupFieldId, formulaFieldId, itemA } =
        await setupLookupFormulaTables();
      const created = await ctx.createRecord(mainTable.id, {
        [nameFieldId]: 'Linked record',
        [linkFieldId]: { id: itemA.id },
      });

      const record = await getRecord(mainTable.id, created.id);
      expect(JSON.stringify(record.fields[lookupFieldId])).toContain('Item A');
      expect(JSON.stringify(record.fields[formulaFieldId])).toContain('Item A');
    });
  });

  // ---------------------------------------------------------------------------
  // lookup formula with blank single select lookup
  // ---------------------------------------------------------------------------

  describe('lookup formula with blank single select lookup', () => {
    const setupOrdersTables = async () => {
      const statusFieldId = createFieldId();
      const planFieldId = createFieldId();
      const ordersTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Orders'),
        fields: [
          {
            type: 'singleSelect',
            id: statusFieldId,
            name: 'Status',
            isPrimary: true,
            options: {
              choices: [
                { name: 'Paid', color: 'green' },
                { name: 'Deposit', color: 'blue' },
              ],
            },
          },
          {
            type: 'singleSelect',
            id: planFieldId,
            name: 'Plan',
            options: {
              choices: [
                { name: 'Plan2', color: 'cyan' },
                { name: 'Plan3', color: 'orange' },
                { name: 'Other', color: 'gray' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const paidOrder = await ctx.createRecord(ordersTable.id, {
        [statusFieldId]: 'Paid',
        [planFieldId]: 'Plan2',
      });
      await ctx.createRecord(ordersTable.id, {
        [statusFieldId]: 'Deposit',
        [planFieldId]: 'Plan3',
      });

      const titleFieldId = createFieldId();
      const linkFieldId = createFieldId();
      const followupTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Order Followups'),
        fields: [
          { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
          {
            type: 'link',
            id: linkFieldId,
            name: 'Order',
            options: {
              relationship: 'manyOne',
              foreignTableId: ordersTable.id,
              lookupFieldId: statusFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const statusLookupFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: followupTable.id,
        field: {
          type: 'lookup',
          id: statusLookupFieldId,
          name: 'Lookup Status',
          options: {
            linkFieldId,
            foreignTableId: ordersTable.id,
            lookupFieldId: statusFieldId,
          },
        },
      });

      const planLookupFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: followupTable.id,
        field: {
          type: 'lookup',
          id: planLookupFieldId,
          name: 'Lookup Plan',
          options: {
            linkFieldId,
            foreignTableId: ordersTable.id,
            lookupFieldId: planFieldId,
          },
        },
      });

      const formulaFieldId = await createFormulaField(
        followupTable.id,
        'Status Notice',
        `IF(
          {${statusLookupFieldId}}="Paid",
          "No reminder",
          IF(
            AND(
              {${statusLookupFieldId}}="Deposit",
              OR(
                {${planLookupFieldId}}="Plan2",
                {${planLookupFieldId}}="Plan3"
              )
            ),
            "Installment follow-up",
            "Tail follow-up"
          )
        )`
      );

      return {
        followupTable,
        titleFieldId,
        linkFieldId,
        statusLookupFieldId,
        planLookupFieldId,
        formulaFieldId,
        paidOrder,
      };
    };

    it('falls back when lookup is blank', async () => {
      const {
        followupTable,
        titleFieldId,
        statusLookupFieldId,
        planLookupFieldId,
        formulaFieldId,
      } = await setupOrdersTables();
      const created = await ctx.createRecord(followupTable.id, {
        [titleFieldId]: 'Unlinked order',
      });

      const record = await getRecord(followupTable.id, created.id);
      expect(record.fields[statusLookupFieldId] ?? null).toBeNull();
      expect(record.fields[planLookupFieldId] ?? null).toBeNull();
      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    });

    it('uses lookup values when record is linked', async () => {
      const {
        followupTable,
        titleFieldId,
        linkFieldId,
        statusLookupFieldId,
        planLookupFieldId,
        formulaFieldId,
        paidOrder,
      } = await setupOrdersTables();
      const created = await ctx.createRecord(followupTable.id, {
        [titleFieldId]: 'Linked order',
        [linkFieldId]: { id: paidOrder.id },
      });

      const record = await getRecord(followupTable.id, created.id);
      expect(JSON.stringify(record.fields[statusLookupFieldId])).toContain('Paid');
      expect(JSON.stringify(record.fields[planLookupFieldId])).toContain('Plan2');
      expect(record.fields[formulaFieldId]).toBe('No reminder');
    });

    it('still falls back when record is created without any field values', async () => {
      const { followupTable, statusLookupFieldId, planLookupFieldId, formulaFieldId } =
        await setupOrdersTables();
      const created = await ctx.createRecord(followupTable.id, {});

      const record = await getRecord(followupTable.id, created.id);
      expect(record.fields[statusLookupFieldId] ?? null).toBeNull();
      expect(record.fields[planLookupFieldId] ?? null).toBeNull();
      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    });

    it('falls back when the only field sent is explicitly null', async () => {
      const {
        followupTable,
        titleFieldId,
        statusLookupFieldId,
        planLookupFieldId,
        formulaFieldId,
      } = await setupOrdersTables();
      const created = await ctx.createRecord(followupTable.id, { [titleFieldId]: null });

      const record = await getRecord(followupTable.id, created.id);
      expect(record.fields[statusLookupFieldId] ?? null).toBeNull();
      expect(record.fields[planLookupFieldId] ?? null).toBeNull();
      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    });
  });

  // ---------------------------------------------------------------------------
  // localized single select numeric coercion
  // ---------------------------------------------------------------------------

  describe('localized single select numeric coercion', () => {
    it('parses localized option labels through VALUE()', async () => {
      const durationFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Localized Duration'),
        fields: [
          {
            type: 'singleSelect',
            id: durationFieldId,
            name: '定型时长',
            isPrimary: true,
            options: {
              preventAutoNewOptions: true,
              choices: [
                { name: '0分钟', color: 'grayDark1' },
                { name: '20分钟', color: 'blueLight1' },
                { name: '30分钟', color: 'blueBright' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const record1 = await ctx.createRecord(table.id, { [durationFieldId]: '0分钟' });
      const record2 = await ctx.createRecord(table.id, { [durationFieldId]: '20分钟' });
      const record3 = await ctx.createRecord(table.id, { [durationFieldId]: '30分钟' });

      const numericFieldId = await createFormulaField(
        table.id,
        '定型时长(数值)',
        `VALUE({${durationFieldId}})`
      );

      const records = await listRecords(table.id);
      expect(records.find((r) => r.id === record1.id)?.fields[numericFieldId]).toBe(0);
      expect(records.find((r) => r.id === record2.id)?.fields[numericFieldId]).toBe(20);
      expect(records.find((r) => r.id === record3.id)?.fields[numericFieldId]).toBe(30);
    });
  });

  // ---------------------------------------------------------------------------
  // conditional numeric cast safety (regression)
  // ---------------------------------------------------------------------------

  describe('conditional numeric cast safety (regression)', () => {
    it('[V2 CONTRACT] creates rows safely and coerces malformed text by its numeric prefix', async () => {
      const displayPriceFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('Numeric Cast Regression'),
        fields: [
          {
            type: 'singleLineText',
            id: displayPriceFieldId,
            name: 'DisplayPrice',
            isPrimary: true,
          },
        ],
        views: [{ type: 'grid' }],
      });
      const formulaFieldId = await createFormulaField(
        table.id,
        'MemberContribution',
        `(IF({${displayPriceFieldId}} < 40, 3, IF({${displayPriceFieldId}} < 50, 4, IF({${displayPriceFieldId}} < 75, 5, 8)))) * 1.6`
      );

      const malformed = await ctx.createRecord(table.id, {
        [displayPriceFieldId]: '39.9339.93',
      });
      const valid = await ctx.createRecord(table.id, { [displayPriceFieldId]: '39.93' });

      const records = await listRecords(table.id);
      const malformedRecord = records.find((r) => r.id === malformed.id);
      const validRecord = records.find((r) => r.id === valid.id);
      expect(malformedRecord).toBeDefined();
      // V2 intentionally parses the leading numeric prefix instead of treating
      // the whole malformed string as non-numeric (the legacy v1 behavior).
      expect(Number(malformedRecord?.fields[formulaFieldId])).toBeCloseTo(4.8, 6);
      expect(Number(validRecord?.fields[formulaFieldId])).toBeCloseTo(4.8, 6);
    });
  });
});
