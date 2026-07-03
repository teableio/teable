import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { explainOkResponseSchema } from '@teable/v2-contract-http';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 field explain endpoints (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId = '';
  let primaryFieldId = '';
  let formulaFieldId = '';
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const postExplain = async (path: string, payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status !== 200) {
      throw new Error(`Explain request failed (${response.status}): ${await response.text()}`);
    }

    const raw = await response.json();
    const parsed = explainOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse explain response');
    }

    return parsed.data.data;
  };

  const normalizeSqlSnapshot = (sql: string, replacements: Record<string, string>) =>
    Object.entries(replacements).reduce(
      (normalized, [actual, replacement]) => normalized.replaceAll(actual, replacement),
      sql
    );

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Field Explain',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;

    primaryFieldId = table.fields.find((field) => field.name === 'Name')?.id ?? '';
    if (!primaryFieldId) {
      throw new Error('Missing primary field id');
    }

    await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Alpha',
    });

    const updatedTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        name: 'Computed',
        options: {
          expression: `{${primaryFieldId}}`,
        },
      },
    });

    formulaFieldId = updatedTable.fields.find((field) => field.name === 'Computed')?.id ?? '';
    if (!formulaFieldId) {
      throw new Error('Missing formula field id');
    }
  });

  afterAll(async () => {
    if (tableId) {
      await ctx.deleteTable(tableId);
    }
  });

  it('explains create field with schema and backfill SQL', async () => {
    const result = await postExplain('/tables/explainCreateField', {
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        name: 'Preview Formula',
        options: {
          expression: `UPPER({${primaryFieldId}})`,
        },
      },
      analyze: false,
      includeSql: true,
      includeGraph: false,
      includeLocks: false,
    });

    expect(result.command.type).toBe('CreateField');
    expect(result.command.changedFieldNames?.[0]).toBe('Preview Formula');
    expect(result.sqlExplains.some((step) => step.sql.toLowerCase().includes('alter table'))).toBe(
      true
    );
    expect(result.sqlExplains.some((step) => step.explainOnly != null)).toBe(true);
  });

  it('explains update field with captured SQL', async () => {
    const result = await postExplain('/tables/explainUpdateField', {
      tableId,
      fieldId: formulaFieldId,
      field: {
        options: {
          expression: `LOWER({${primaryFieldId}})`,
        },
      },
      analyze: false,
      includeSql: true,
      includeGraph: false,
      includeLocks: false,
    });

    expect(result.command.type).toBe('UpdateField');
    expect(result.command.changedFieldIds).toEqual([formulaFieldId]);
    expect(result.sqlExplains.length).toBeGreaterThan(0);
    expect(
      result.sqlExplains.some((step) => {
        const normalized = step.sql.toLowerCase();
        return normalized.startsWith('update ') || normalized.startsWith('with ');
      })
    ).toBe(true);
  });

  it('explains delete field with drop-column SQL', async () => {
    const result = await postExplain('/tables/explainDeleteField', {
      baseId: ctx.baseId,
      tableId,
      fieldId: formulaFieldId,
      analyze: false,
      includeSql: true,
      includeGraph: false,
      includeLocks: false,
    });

    expect(result.command.type).toBe('DeleteField');
    expect(result.command.changedFieldIds).toEqual([formulaFieldId]);
    expect(result.sqlExplains.some((step) => step.sql.toLowerCase().includes('drop column'))).toBe(
      true
    );
  });

  it('snapshots anonymized formula SQL diagnostics without running SQL explain', async () => {
    const createdTableIds: string[] = [];

    const itemLabelFieldId = createFieldId();
    const itemCodeFieldId = createFieldId();
    const notesFieldId = createFieldId();
    const amountFieldId = createFieldId();
    const quantityFieldId = createFieldId();
    const unitPriceFieldId = createFieldId();
    const deltaExplanationFieldId = createFieldId();
    const actionLineTextFieldId = createFieldId();
    const parentLineLinkFieldId = createFieldId();
    const parentDeltaRollupFieldId = createFieldId();
    const parentActionRollupFieldId = createFieldId();
    const parentSummaryFormulaFieldId = createFieldId();
    const sourceLineLinkFieldId = createFieldId();
    const sourceDeltaRollupFieldId = createFieldId();
    const actualQuantityFieldId = createFieldId();
    const plannedQuantityFieldId = createFieldId();
    const sourceUnitPriceFieldId = createFieldId();
    const sourceTotalFieldId = createFieldId();
    const sourceStatusFieldId = createFieldId();
    const plannedValueFieldId = createFieldId();
    const actualValueFieldId = createFieldId();
    const priceDeltaFieldId = createFieldId();
    const quantityDeltaFieldId = createFieldId();
    const amountDeltaFieldId = createFieldId();
    const lineStateFieldId = createFieldId();
    const isDeltaFieldId = createFieldId();
    const isMatchedFieldId = createFieldId();
    const actionEligibleFieldId = createFieldId();
    const actionReasonFieldId = createFieldId();
    const actionAmountFieldId = createFieldId();
    const severityFieldId = createFieldId();
    const referenceUnitPriceFieldId = createFieldId();
    const billedUnitPriceFieldId = createFieldId();
    const deltaReasonFieldId = createFieldId();

    const anonymizedFormulaExpressions = {
      price_delta: `IF(AND(OR({${sourceStatusFieldId}} = "closed", {${sourceStatusFieldId}} = "ready"), {${plannedValueFieldId}} > 0, {${actualValueFieldId}} > 0), ROUND({${amountFieldId}} - {${plannedValueFieldId}}, 2), BLANK())`,
      quantity_delta: `IF(AND(OR({${sourceStatusFieldId}} = "closed", {${sourceStatusFieldId}} = "ready"), {${plannedValueFieldId}} > 0, {${actualValueFieldId}} > 0), ROUND({${plannedValueFieldId}} - {${actualValueFieldId}}, 2), BLANK())`,
      amount_delta: `IF(AND(OR({${sourceStatusFieldId}} = "closed", {${sourceStatusFieldId}} = "ready"), {${actualValueFieldId}} > 0), ROUND({${amountFieldId}} - {${actualValueFieldId}}, 2), BLANK())`,
      line_state: `IF({${itemCodeFieldId}} = BLANK(), "missing_code", IF(NOT(OR({${sourceStatusFieldId}} = "closed", {${sourceStatusFieldId}} = "ready", {${sourceStatusFieldId}} = "planned")), "waiting_source", IF({${sourceStatusFieldId}} = "planned", "waiting_source", IF(NOT({${actualValueFieldId}} > 0), "missing_value", IF(ABS({${amountDeltaFieldId}}) <= 1.0, "matched", "delta")))))`,
      is_delta: `{${lineStateFieldId}} = "delta"`,
      is_matched: `{${lineStateFieldId}} = "matched"`,
      action_eligible: `AND(OR({${sourceStatusFieldId}} = "closed", {${sourceStatusFieldId}} = "ready"), {${amountDeltaFieldId}} >= 10.0)`,
      action_reason: `IF(NOT({${actionEligibleFieldId}}), BLANK(), "billed amount (" & T({${amountFieldId}}) & " units) is greater than actual reference value (" & T({${actualValueFieldId}}) & " units)")`,
      action_line_text: `IF(NOT({${actionEligibleFieldId}}), BLANK(), "\n- " & {${itemLabelFieldId}} & " (code " & T({${itemCodeFieldId}}) & ") : billed " & T({${amountFieldId}}) & " units, actual value " & T({${actualValueFieldId}}) & " units (reference) -> delta " & T({${amountDeltaFieldId}}) & " units -- " & {${actionReasonFieldId}})`,
      action_amount: `IF(NOT({${actionEligibleFieldId}}), BLANK(), {${amountDeltaFieldId}})`,
      severity: `IF(OR(NOT({${isDeltaFieldId}}), BLANK({${amountDeltaFieldId}})), BLANK(), IF(ABS({${amountDeltaFieldId}}) < 2.0, "low", IF(ABS({${amountDeltaFieldId}}) > 200.0, "major", "minor")))`,
      reference_unit_price: `IF({${plannedQuantityFieldId}} > 0, ROUND({${plannedValueFieldId}} / {${plannedQuantityFieldId}}, 4), BLANK())`,
      billed_unit_price: `IF(AND({${plannedQuantityFieldId}} > 0, {${amountFieldId}} > 0), ROUND({${amountFieldId}} / {${plannedQuantityFieldId}}, 4), BLANK())`,
      delta_reason: `IF(NOT({${isDeltaFieldId}}), BLANK(), IF(NOT({${plannedValueFieldId}} > 0), BLANK(), IF(AND(ABS({${priceDeltaFieldId}}) > 1.0, ABS({${quantityDeltaFieldId}}) > 1.0), "Price (" & T({${priceDeltaFieldId}}) & " units): billed " & T({${billedUnitPriceFieldId}}) & "/u vs reference " & T({${referenceUnitPriceFieldId}}) & "/u. Quantity (" & T({${quantityDeltaFieldId}}) & " units): " & IF({${plannedQuantityFieldId}} = ROUND({${plannedQuantityFieldId}}, 0), T(ROUND({${plannedQuantityFieldId}}, 0)), T(ROUND({${plannedQuantityFieldId}}, 2))) & " planned, " & IF({${actualQuantityFieldId}} = ROUND({${actualQuantityFieldId}}, 0), T(ROUND({${actualQuantityFieldId}}, 0)), T(ROUND({${actualQuantityFieldId}}, 2))) & " actual.", IF(ABS({${priceDeltaFieldId}}) > 1.0, "Price: billed " & T({${billedUnitPriceFieldId}}) & "/u vs reference " & T({${referenceUnitPriceFieldId}}) & "/u.", IF(ABS({${quantityDeltaFieldId}}) > 1.0, IF({${quantityDeltaFieldId}} >= 0, "Under target: ", "Over target: ") & IF({${plannedQuantityFieldId}} = ROUND({${plannedQuantityFieldId}}, 0), T(ROUND({${plannedQuantityFieldId}}, 0)), T(ROUND({${plannedQuantityFieldId}}, 2))) & " planned, " & IF({${actualQuantityFieldId}} = ROUND({${actualQuantityFieldId}}, 0), T(ROUND({${actualQuantityFieldId}}, 0)), T(ROUND({${actualQuantityFieldId}}, 2))) & " actual.", "Mixed delta: " & T({${priceDeltaFieldId}}) & " units price, " & T({${quantityDeltaFieldId}}) & " units quantity.")))))`,
      delta_explanation: `IF(NOT({${isDeltaFieldId}}), BLANK(), "\n* " & {${itemLabelFieldId}} & " (code " & T({${itemCodeFieldId}}) & ") : delta " & T({${amountDeltaFieldId}}) & " units. " & IF({${deltaReasonFieldId}} = BLANK(), "No source breakdown.", {${deltaReasonFieldId}}))`,
    };

    const createLookupField = async (args: {
      tableId: string;
      id: string;
      name: string;
      linkFieldId: string;
      foreignTableId: string;
      lookupFieldId: string;
    }) =>
      ctx.createField({
        baseId: ctx.baseId,
        tableId: args.tableId,
        field: {
          type: 'lookup',
          id: args.id,
          name: args.name,
          options: {
            linkFieldId: args.linkFieldId,
            foreignTableId: args.foreignTableId,
            lookupFieldId: args.lookupFieldId,
          },
        },
      });

    const createFormulaField = async (
      tableId: string,
      id: string,
      name: string,
      expression: string,
      formatting?: { type: 'decimal'; precision: number }
    ) =>
      ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          id,
          name,
          options: {
            expression,
            timeZone: 'utc',
            ...(formatting ? { formatting } : {}),
          },
        },
      });

    try {
      expect(anonymizedFormulaExpressions).toMatchInlineSnapshot(`
        {
          "action_amount": "IF(NOT({fld000000000000000r}), BLANK(), {fld000000000000000n})",
          "action_eligible": "AND(OR({fld000000000000000i} = "closed", {fld000000000000000i} = "ready"), {fld000000000000000n} >= 10.0)",
          "action_line_text": "IF(NOT({fld000000000000000r}), BLANK(), "
        - " & {fld0000000000000000} & " (code " & T({fld0000000000000001}) & ") : billed " & T({fld0000000000000003}) & " units, actual value " & T({fld000000000000000k}) & " units (reference) -> delta " & T({fld000000000000000n}) & " units -- " & {fld000000000000000s})",
          "action_reason": "IF(NOT({fld000000000000000r}), BLANK(), "billed amount (" & T({fld0000000000000003}) & " units) is greater than actual reference value (" & T({fld000000000000000k}) & " units)")",
          "amount_delta": "IF(AND(OR({fld000000000000000i} = "closed", {fld000000000000000i} = "ready"), {fld000000000000000k} > 0), ROUND({fld0000000000000003} - {fld000000000000000k}, 2), BLANK())",
          "billed_unit_price": "IF(AND({fld000000000000000f} > 0, {fld0000000000000003} > 0), ROUND({fld0000000000000003} / {fld000000000000000f}, 4), BLANK())",
          "delta_explanation": "IF(NOT({fld000000000000000p}), BLANK(), "
        * " & {fld0000000000000000} & " (code " & T({fld0000000000000001}) & ") : delta " & T({fld000000000000000n}) & " units. " & IF({fld000000000000000x} = BLANK(), "No source breakdown.", {fld000000000000000x}))",
          "delta_reason": "IF(NOT({fld000000000000000p}), BLANK(), IF(NOT({fld000000000000000j} > 0), BLANK(), IF(AND(ABS({fld000000000000000l}) > 1.0, ABS({fld000000000000000m}) > 1.0), "Price (" & T({fld000000000000000l}) & " units): billed " & T({fld000000000000000w}) & "/u vs reference " & T({fld000000000000000v}) & "/u. Quantity (" & T({fld000000000000000m}) & " units): " & IF({fld000000000000000f} = ROUND({fld000000000000000f}, 0), T(ROUND({fld000000000000000f}, 0)), T(ROUND({fld000000000000000f}, 2))) & " planned, " & IF({fld000000000000000e} = ROUND({fld000000000000000e}, 0), T(ROUND({fld000000000000000e}, 0)), T(ROUND({fld000000000000000e}, 2))) & " actual.", IF(ABS({fld000000000000000l}) > 1.0, "Price: billed " & T({fld000000000000000w}) & "/u vs reference " & T({fld000000000000000v}) & "/u.", IF(ABS({fld000000000000000m}) > 1.0, IF({fld000000000000000m} >= 0, "Under target: ", "Over target: ") & IF({fld000000000000000f} = ROUND({fld000000000000000f}, 0), T(ROUND({fld000000000000000f}, 0)), T(ROUND({fld000000000000000f}, 2))) & " planned, " & IF({fld000000000000000e} = ROUND({fld000000000000000e}, 0), T(ROUND({fld000000000000000e}, 0)), T(ROUND({fld000000000000000e}, 2))) & " actual.", "Mixed delta: " & T({fld000000000000000l}) & " units price, " & T({fld000000000000000m}) & " units quantity.")))))",
          "is_delta": "{fld000000000000000o} = "delta"",
          "is_matched": "{fld000000000000000o} = "matched"",
          "line_state": "IF({fld0000000000000001} = BLANK(), "missing_code", IF(NOT(OR({fld000000000000000i} = "closed", {fld000000000000000i} = "ready", {fld000000000000000i} = "planned")), "waiting_source", IF({fld000000000000000i} = "planned", "waiting_source", IF(NOT({fld000000000000000k} > 0), "missing_value", IF(ABS({fld000000000000000n}) <= 1.0, "matched", "delta")))))",
          "price_delta": "IF(AND(OR({fld000000000000000i} = "closed", {fld000000000000000i} = "ready"), {fld000000000000000j} > 0, {fld000000000000000k} > 0), ROUND({fld0000000000000003} - {fld000000000000000j}, 2), BLANK())",
          "quantity_delta": "IF(AND(OR({fld000000000000000i} = "closed", {fld000000000000000i} = "ready"), {fld000000000000000j} > 0, {fld000000000000000k} > 0), ROUND({fld000000000000000j} - {fld000000000000000k}, 2), BLANK())",
          "reference_unit_price": "IF({fld000000000000000f} > 0, ROUND({fld000000000000000j} / {fld000000000000000f}, 4), BLANK())",
          "severity": "IF(OR(NOT({fld000000000000000p}), BLANK({fld000000000000000n})), BLANK(), IF(ABS({fld000000000000000n}) < 2.0, "low", IF(ABS({fld000000000000000n}) > 200.0, "major", "minor")))",
        }
      `);

      const sourceKeyFieldId = createFieldId();
      const sourceActualQuantityFieldId = createFieldId();
      const sourcePlannedQuantityFieldId = createFieldId();
      const sourceReferencePriceFieldId = createFieldId();
      const sourceTotalSourceFieldId = createFieldId();
      const sourceStatusSourceFieldId = createFieldId();
      const sourcePlannedValueFieldId = createFieldId();
      const sourceActualValueFieldId = createFieldId();

      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `perf-sources-${randomUUID()}`,
        fields: [
          {
            type: 'singleLineText',
            id: sourceKeyFieldId,
            name: 'source_key',
            isPrimary: true,
          },
          { type: 'number', id: sourceActualQuantityFieldId, name: 'actual_quantity' },
          { type: 'number', id: sourcePlannedQuantityFieldId, name: 'planned_quantity' },
          { type: 'number', id: sourceReferencePriceFieldId, name: 'source_unit_price' },
          {
            type: 'number',
            id: sourceTotalSourceFieldId,
            name: 'source_total',
          },
          { type: 'singleLineText', id: sourceStatusSourceFieldId, name: 'source_status' },
          {
            type: 'number',
            id: sourcePlannedValueFieldId,
            name: 'planned_value',
          },
          { type: 'number', id: sourceActualValueFieldId, name: 'actual_value' },
        ],
        records: [
          {
            fields: {
              [sourceKeyFieldId]: 'SRC-1',
              [sourceActualQuantityFieldId]: 8,
              [sourcePlannedQuantityFieldId]: 10,
              [sourceReferencePriceFieldId]: 3,
              [sourceTotalSourceFieldId]: 30,
              [sourceStatusSourceFieldId]: 'ready',
              [sourcePlannedValueFieldId]: 30,
              [sourceActualValueFieldId]: 24,
            },
          },
        ],
      });
      createdTableIds.push(sourceTable.id);
      const sourceRecord = (await ctx.listRecords(sourceTable.id))[0];
      if (!sourceRecord) {
        throw new Error('Missing source seed record');
      }

      const parentKeyFieldId = createFieldId();
      const lineTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `perf-lines-${randomUUID()}`,
        fields: [
          {
            type: 'singleLineText',
            id: itemLabelFieldId,
            name: 'item_label',
            isPrimary: true,
          },
          { type: 'singleLineText', id: itemCodeFieldId, name: 'item_code' },
          { type: 'longText', id: notesFieldId, name: 'notes' },
          { type: 'number', id: amountFieldId, name: 'amount' },
          { type: 'number', id: quantityFieldId, name: 'quantity' },
          { type: 'number', id: unitPriceFieldId, name: 'unit_price' },
        ],
        records: [
          {
            fields: {
              [itemLabelFieldId]: 'item alpha',
              [itemCodeFieldId]: 'SKU-1',
              [notesFieldId]: 'not referenced by computed fields',
              [amountFieldId]: 36,
              [quantityFieldId]: 12,
              [unitPriceFieldId]: 3,
            },
          },
        ],
      });
      createdTableIds.push(lineTable.id);

      const lineRecord = (await ctx.listRecords(lineTable.id))[0];
      if (!lineRecord) {
        throw new Error('Missing line_items seed record');
      }

      const parentTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `perf-parents-${randomUUID()}`,
        fields: [
          {
            type: 'singleLineText',
            id: parentKeyFieldId,
            name: 'parent_key',
            isPrimary: true,
          },
        ],
        records: [{ fields: { [parentKeyFieldId]: 'PARENT-1' } }],
      });
      createdTableIds.push(parentTable.id);
      const parentRecord = (await ctx.listRecords(parentTable.id))[0];
      if (!parentRecord) {
        throw new Error('Missing parent seed record');
      }

      const lineSourceLinkFieldId = createFieldId();
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: lineTable.id,
        field: {
          type: 'link',
          id: lineSourceLinkFieldId,
          name: 'source_record',
          options: {
            relationship: 'manyOne',
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceKeyFieldId,
          },
        },
      });

      await createLookupField({
        tableId: lineTable.id,
        id: actualQuantityFieldId,
        name: 'actual_quantity',
        linkFieldId: lineSourceLinkFieldId,
        foreignTableId: sourceTable.id,
        lookupFieldId: sourceActualQuantityFieldId,
      });
      await createLookupField({
        tableId: lineTable.id,
        id: plannedQuantityFieldId,
        name: 'planned_quantity',
        linkFieldId: lineSourceLinkFieldId,
        foreignTableId: sourceTable.id,
        lookupFieldId: sourcePlannedQuantityFieldId,
      });
      await createLookupField({
        tableId: lineTable.id,
        id: sourceUnitPriceFieldId,
        name: 'source_unit_price',
        linkFieldId: lineSourceLinkFieldId,
        foreignTableId: sourceTable.id,
        lookupFieldId: sourceReferencePriceFieldId,
      });
      await createLookupField({
        tableId: lineTable.id,
        id: sourceTotalFieldId,
        name: 'source_total',
        linkFieldId: lineSourceLinkFieldId,
        foreignTableId: sourceTable.id,
        lookupFieldId: sourceTotalSourceFieldId,
      });
      await createLookupField({
        tableId: lineTable.id,
        id: sourceStatusFieldId,
        name: 'source_status',
        linkFieldId: lineSourceLinkFieldId,
        foreignTableId: sourceTable.id,
        lookupFieldId: sourceStatusSourceFieldId,
      });
      await createLookupField({
        tableId: lineTable.id,
        id: plannedValueFieldId,
        name: 'planned_value',
        linkFieldId: lineSourceLinkFieldId,
        foreignTableId: sourceTable.id,
        lookupFieldId: sourcePlannedValueFieldId,
      });
      await createLookupField({
        tableId: lineTable.id,
        id: actualValueFieldId,
        name: 'actual_value',
        linkFieldId: lineSourceLinkFieldId,
        foreignTableId: sourceTable.id,
        lookupFieldId: sourceActualValueFieldId,
      });

      await createFormulaField(
        lineTable.id,
        priceDeltaFieldId,
        'price_delta',
        anonymizedFormulaExpressions['price_delta'],
        { type: 'decimal', precision: 2 }
      );
      await createFormulaField(
        lineTable.id,
        quantityDeltaFieldId,
        'quantity_delta',
        anonymizedFormulaExpressions['quantity_delta'],
        { type: 'decimal', precision: 2 }
      );
      await createFormulaField(
        lineTable.id,
        amountDeltaFieldId,
        'amount_delta',
        anonymizedFormulaExpressions['amount_delta'],
        { type: 'decimal', precision: 2 }
      );
      await createFormulaField(
        lineTable.id,
        lineStateFieldId,
        'line_state',
        anonymizedFormulaExpressions['line_state']
      );
      await createFormulaField(
        lineTable.id,
        isDeltaFieldId,
        'is_delta',
        anonymizedFormulaExpressions.is_delta
      );
      await createFormulaField(
        lineTable.id,
        isMatchedFieldId,
        'is_matched',
        anonymizedFormulaExpressions.is_matched
      );
      await createFormulaField(
        lineTable.id,
        actionEligibleFieldId,
        'action_eligible',
        anonymizedFormulaExpressions.action_eligible
      );
      await createFormulaField(
        lineTable.id,
        actionReasonFieldId,
        'action_reason',
        anonymizedFormulaExpressions['action_reason']
      );
      await createFormulaField(
        lineTable.id,
        actionLineTextFieldId,
        'action_line_text',
        anonymizedFormulaExpressions.action_line_text
      );
      await createFormulaField(
        lineTable.id,
        actionAmountFieldId,
        'action_amount',
        anonymizedFormulaExpressions.action_amount,
        { type: 'decimal', precision: 2 }
      );
      await createFormulaField(
        lineTable.id,
        severityFieldId,
        'severity',
        anonymizedFormulaExpressions.severity
      );
      await createFormulaField(
        lineTable.id,
        referenceUnitPriceFieldId,
        'reference_unit_price',
        anonymizedFormulaExpressions['reference_unit_price'],
        { type: 'decimal', precision: 2 }
      );
      await createFormulaField(
        lineTable.id,
        billedUnitPriceFieldId,
        'billed_unit_price',
        anonymizedFormulaExpressions['billed_unit_price'],
        { type: 'decimal', precision: 2 }
      );
      await createFormulaField(
        lineTable.id,
        deltaReasonFieldId,
        'delta_reason',
        anonymizedFormulaExpressions['delta_reason']
      );
      await createFormulaField(
        lineTable.id,
        deltaExplanationFieldId,
        'delta_explanation',
        anonymizedFormulaExpressions['delta_explanation']
      );

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: parentTable.id,
        field: {
          type: 'link',
          id: parentLineLinkFieldId,
          name: 'line_items',
          options: {
            relationship: 'manyMany',
            foreignTableId: lineTable.id,
            lookupFieldId: itemLabelFieldId,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: parentTable.id,
        field: {
          type: 'rollup',
          id: parentDeltaRollupFieldId,
          name: 'delta_explanations_raw',
          options: { expression: 'array_join({values})' },
          config: {
            linkFieldId: parentLineLinkFieldId,
            foreignTableId: lineTable.id,
            lookupFieldId: deltaExplanationFieldId,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: parentTable.id,
        field: {
          type: 'rollup',
          id: parentActionRollupFieldId,
          name: 'action_lines_raw',
          options: { expression: 'array_join({values})' },
          config: {
            linkFieldId: parentLineLinkFieldId,
            foreignTableId: lineTable.id,
            lookupFieldId: actionLineTextFieldId,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: parentTable.id,
        field: {
          type: 'formula',
          id: parentSummaryFormulaFieldId,
          name: 'delta_summary',
          options: {
            expression: `CONCATENATE({${parentDeltaRollupFieldId}}, " | ", {${parentActionRollupFieldId}})`,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: sourceTable.id,
        field: {
          type: 'link',
          id: sourceLineLinkFieldId,
          name: 'line_items',
          options: {
            relationship: 'manyMany',
            foreignTableId: lineTable.id,
            lookupFieldId: itemLabelFieldId,
          },
        },
      });

      await ctx.updateRecord(lineTable.id, lineRecord.id, {
        [lineSourceLinkFieldId]: { id: sourceRecord.id },
      });
      await ctx.updateRecord(parentTable.id, parentRecord.id, {
        [parentLineLinkFieldId]: [{ id: lineRecord.id }],
      });
      await ctx.updateRecord(sourceTable.id, sourceRecord.id, {
        [sourceLineLinkFieldId]: [{ id: lineRecord.id }],
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: sourceTable.id,
        field: {
          type: 'rollup',
          id: sourceDeltaRollupFieldId,
          name: 'source_delta_explanations_raw',
          options: { expression: 'array_join({values})' },
          config: {
            linkFieldId: sourceLineLinkFieldId,
            foreignTableId: lineTable.id,
            lookupFieldId: deltaExplanationFieldId,
          },
        },
      });

      const inertLongTextExplain = await postExplain('/tables/explainUpdateRecord', {
        tableId: lineTable.id,
        recordId: lineRecord.id,
        fields: {
          [notesFieldId]: 'changed but still not referenced',
        },
        includeSql: false,
        includeGraph: true,
        includeLocks: false,
      });

      expect(inertLongTextExplain.command.changedFieldNames).toEqual(['notes']);
      expect(inertLongTextExplain.sqlExplains).toEqual([]);
      expect(inertLongTextExplain.computedImpact?.updateSteps).toEqual([]);

      const itemLabelExplain = await postExplain('/tables/explainUpdateRecord', {
        tableId: lineTable.id,
        recordId: lineRecord.id,
        fields: {
          [itemLabelFieldId]: 'item alpha updated',
        },
        includeSql: true,
        includeGraph: true,
        includeLocks: false,
        sqlExplainMode: 'dump',
      });

      const impactedTables = new Set(
        itemLabelExplain.computedImpact?.updateSteps.map((step) => step.tableName) ?? []
      );
      expect(impactedTables.has(lineTable.name)).toBe(true);
      expect(impactedTables.has(parentTable.name)).toBe(true);
      expect(impactedTables.has(sourceTable.name)).toBe(true);

      const impactedFieldNames = new Set(
        itemLabelExplain.computedImpact?.updateSteps.flatMap((step) => step.fieldNames) ?? []
      );
      expect(impactedFieldNames.has('delta_explanation')).toBe(true);
      expect(impactedFieldNames.has('action_line_text')).toBe(true);
      expect(impactedFieldNames.has('delta_explanations_raw')).toBe(true);
      expect(impactedFieldNames.has('delta_summary')).toBe(true);
      expect(impactedFieldNames.has('source_delta_explanations_raw')).toBe(true);

      expect(itemLabelExplain.sqlExplains.length).toBeGreaterThan(1);
      expect(
        itemLabelExplain.sqlExplains.every(
          (step) =>
            step.sql.length > 0 &&
            step.explainOnly == null &&
            step.explainAnalyze == null &&
            step.explainError == null
        )
      ).toBe(true);

      const mainUpdateSqlLength = itemLabelExplain.sqlExplains[0]?.sql.length ?? 0;
      const computedSqlLengths = itemLabelExplain.sqlExplains
        .filter((step) => step.stepDescription.startsWith('Computed update batch'))
        .map((step) => step.sql.length);
      const computedSqlDiagnostics = itemLabelExplain.sqlExplains
        .filter((step) => step.stepDescription.startsWith('Computed update batch'))
        .map((step) => step.sqlDiagnostics);
      expect(computedSqlLengths.length).toBeGreaterThan(0);
      expect(Math.max(...computedSqlLengths)).toBeGreaterThan(mainUpdateSqlLength);
      expect(computedSqlDiagnostics.every(Boolean)).toBe(true);
      expect(
        Math.max(...computedSqlDiagnostics.map((diagnostics) => diagnostics?.sqlLength ?? 0))
      ).toBeGreaterThan(mainUpdateSqlLength);
      expect(itemLabelExplain.complexity.score).toBeGreaterThan(
        inertLongTextExplain.complexity.score
      );

      const updateSteps = itemLabelExplain.computedImpact?.updateSteps ?? [];
      const computedSqlSummary = itemLabelExplain.sqlExplains
        .filter((step) => step.stepDescription.startsWith('Computed update batch'))
        .map((step, index) => ({
          fields: (updateSteps[index]?.fieldNames ?? []).map((fieldName) =>
            fieldName.startsWith('perf-lines-') ? '<line primary title>' : fieldName
          ),
          diagnostics: step.sqlDiagnostics,
        }))
        .sort(
          (left, right) => (right.diagnostics?.sqlLength ?? 0) - (left.diagnostics?.sqlLength ?? 0)
        );
      const computedSqlBatches = itemLabelExplain.sqlExplains
        .filter((step) => step.stepDescription.startsWith('Computed update batch'))
        .map((step, index) => ({
          fields: updateSteps[index]?.fieldNames ?? [],
          sql: step.sql,
          sqlLength: step.sql.length,
        }));
      const heaviestComputedSqlBatch = [...computedSqlBatches].sort(
        (left, right) => right.sqlLength - left.sqlLength
      )[0];
      expect(heaviestComputedSqlBatch?.fields).toEqual(['delta_explanation', 'action_line_text']);
      await expect(
        normalizeSqlSnapshot(heaviestComputedSqlBatch.sql, {
          [ctx.baseId]: '<base-id>',
          [lineTable.id]: '<line-table-id>',
          [parentTable.id]: '<parent-table-id>',
          [sourceTable.id]: '<source-table-id>',
          [lineRecord.id]: '<line-record-id>',
        })
      ).toMatchFileSnapshot('./__snapshots__/field-explain.anonymized-formula-update.sql');

      expect(computedSqlSummary).toMatchInlineSnapshot(`
        [
          {
            "diagnostics": {
              "jsonbAggCount": 0,
              "lateralJoinCount": 0,
              "parameterCount": 0,
              "pgInputIsValidCount": 1,
              "regexpReplaceCount": 0,
              "sqlLength": 3830,
              "stringAggCount": 1,
            },
            "fields": [
              "delta_explanation",
              "action_line_text",
            ],
          },
          {
            "diagnostics": {
              "jsonbAggCount": 0,
              "lateralJoinCount": 1,
              "parameterCount": 1,
              "pgInputIsValidCount": 0,
              "regexpReplaceCount": 0,
              "sqlLength": 2574,
              "stringAggCount": 2,
            },
            "fields": [
              "delta_explanations_raw",
              "action_lines_raw",
            ],
          },
          {
            "diagnostics": {
              "jsonbAggCount": 2,
              "lateralJoinCount": 2,
              "parameterCount": 1,
              "pgInputIsValidCount": 0,
              "regexpReplaceCount": 0,
              "sqlLength": 2504,
              "stringAggCount": 0,
            },
            "fields": [
              "<line primary title>",
              "line_items",
            ],
          },
          {
            "diagnostics": {
              "jsonbAggCount": 0,
              "lateralJoinCount": 1,
              "parameterCount": 1,
              "pgInputIsValidCount": 0,
              "regexpReplaceCount": 0,
              "sqlLength": 1594,
              "stringAggCount": 1,
            },
            "fields": [
              "source_delta_explanations_raw",
            ],
          },
          {
            "diagnostics": {
              "jsonbAggCount": 1,
              "lateralJoinCount": 1,
              "parameterCount": 1,
              "pgInputIsValidCount": 0,
              "regexpReplaceCount": 0,
              "sqlLength": 1558,
              "stringAggCount": 0,
            },
            "fields": [
              "line_items",
            ],
          },
        ]
      `);

    } finally {
      for (const tableIdToDelete of createdTableIds.reverse()) {
        await ctx.deleteTable(tableIdToDelete).catch(() => undefined);
      }
    }
  }, 60000);

  it('[V1 PARITY] ignores stale references to deleted fields when explaining singleSelect updates', async () => {
    let hostTableId: string | undefined;
    let tempTableId: string | undefined;
    let staleReferenceId: string | undefined;

    try {
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Field Explain SingleSelect ${randomUUID()}`,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            name: 'School',
            options: ['School A'],
          },
        ],
        views: [{ type: 'grid' }],
      });
      hostTableId = hostTable.id;

      const singleSelectFieldId = hostTable.fields.find((field) => field.name === 'School')?.id;
      if (!singleSelectFieldId) {
        throw new Error('Missing single select field id');
      }

      const hostWithFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTableId,
        field: {
          type: 'formula',
          name: 'School Copy',
          options: {
            expression: `{${singleSelectFieldId}}`,
          },
        },
      });
      const formulaCopyFieldId = hostWithFormula.fields.find(
        (field) => field.name === 'School Copy'
      )?.id;
      if (!formulaCopyFieldId) {
        throw new Error('Missing formula field id');
      }

      const tempTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Field Explain Deleted Ref ${randomUUID()}`,
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      tempTableId = tempTable.id;

      const deletedFieldId = tempTable.fields.find((field) => field.isPrimary)?.id;
      if (!deletedFieldId) {
        throw new Error('Missing deleted field id');
      }

      await ctx.deleteTable(tempTableId);
      tempTableId = undefined;

      const deletedFieldRow = await ctx.testContainer.db
        .selectFrom('field')
        .select(['id', 'deleted_time'])
        .where('id', '=', deletedFieldId)
        .executeTakeFirst();
      expect(deletedFieldRow?.deleted_time).not.toBeNull();

      staleReferenceId = `ref_${randomUUID()}`;
      await ctx.testContainer.db
        .insertInto('reference')
        .values({
          id: staleReferenceId,
          from_field_id: singleSelectFieldId,
          to_field_id: deletedFieldId,
        })
        .onConflict((oc) => oc.columns(['to_field_id', 'from_field_id']).doNothing())
        .execute();

      const explainResult = await postExplain('/tables/explainUpdateField', {
        tableId: hostTableId,
        fieldId: singleSelectFieldId,
        field: {
          options: {
            choices: [
              { id: 'choSchoolA', name: 'School A', color: 'blueBright' },
              { id: 'choSchoolB', name: 'School B', color: 'greenBright' },
            ],
          },
        },
        analyze: false,
        includeSql: true,
        includeGraph: false,
        includeLocks: false,
      });

      expect(explainResult.command.type).toBe('UpdateField');
      expect(explainResult.command.changedFieldIds).toEqual([singleSelectFieldId]);
      expect(explainResult.sqlExplains.length).toBeGreaterThan(0);

      const updatedTable = await ctx.updateField({
        tableId: hostTableId,
        fieldId: singleSelectFieldId,
        field: {
          options: {
            choices: [
              { id: 'choSchoolA', name: 'School A', color: 'blueBright' },
              { id: 'choSchoolB', name: 'School B', color: 'greenBright' },
            ],
          },
        },
      });

      const updatedField = updatedTable.fields.find((field) => field.id === singleSelectFieldId) as
        | { options?: { choices?: Array<{ name: string }> } }
        | undefined;
      expect(updatedField?.options?.choices?.map((choice) => choice.name)).toEqual([
        'School A',
        'School B',
      ]);

      const formulaAfter = updatedTable.fields.find((field) => field.id === formulaCopyFieldId);
      expect(formulaAfter).toBeTruthy();
    } finally {
      if (staleReferenceId) {
        await ctx.testContainer.db
          .deleteFrom('reference')
          .where('id', '=', staleReferenceId)
          .execute();
      }
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (tempTableId) {
        await ctx.deleteTable(tempTableId).catch(() => undefined);
      }
    }
  });
});
