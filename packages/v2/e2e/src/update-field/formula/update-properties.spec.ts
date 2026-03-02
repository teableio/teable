/**
 * E2E tests for updating Formula field properties.
 *
 * Formula fields are computed, so:
 * - Expression changes trigger recalculation
 * - Formatting affects display only
 * - Type conversions FROM formula not supported
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

type DomainEventLike = {
  name: {
    toString(): string;
  };
  fieldId?: {
    toString(): string;
  };
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const getBatchChangedFieldIds = (event: unknown): string[] => {
  if (!isObjectRecord(event)) {
    return [];
  }

  const updates = event['updates'];
  if (!Array.isArray(updates)) {
    return [];
  }

  const changedFieldIds: string[] = [];
  for (const update of updates) {
    if (!isObjectRecord(update)) continue;
    const changes = update['changes'];
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      if (!isObjectRecord(change)) continue;
      const fieldId = change['fieldId'];
      if (typeof fieldId === 'string') {
        changedFieldIds.push(fieldId);
      }
    }
  }

  return changedFieldIds;
};

describe('update-field: formula property updates', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('[V1 PARITY] should preserve formula values when changing timezone option', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-timezone-update',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
      if (!primaryFieldId) throw new Error('Primary field not found');

      const tableWithDate = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'date', name: 'event_date' },
      });
      const dateField = tableWithDate.fields.find((f) => f.name === 'event_date');
      if (!dateField) throw new Error('Date field not found');

      const expression = `DATETIME_FORMAT({${dateField.id}}, 'YYYY-MM-DD HH:mm:ss')`;
      const tableWithFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'formatted_date',
          options: {
            expression,
          },
        },
      });
      const formulaField = tableWithFormula.fields.find((f) => f.name === 'formatted_date');
      if (!formulaField) throw new Error('Formula field not found');

      await ctx.createRecords(tableId, [
        {
          fields: {
            [primaryFieldId]: 'row-1',
            [dateField.id]: '2024-12-03T09:07:11.000Z',
          },
        },
      ]);
      await ctx.drainOutbox();

      const recordsBefore = await ctx.listRecords(tableId);
      expect(recordsBefore[0]?.fields[formulaField.id]).toBe('2024-12-03 09:07:11');

      await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: {
            expression,
            timeZone: 'Asia/Shanghai',
          },
        },
      });
      await ctx.drainOutbox();

      const recordsAfter = await ctx.listRecords(tableId);
      expect(recordsAfter[0]?.fields[formulaField.id]).toBe('2024-12-03 17:07:11');
    } finally {
      if (tableId) {
        await ctx.deleteTable(tableId);
      }
    }
  });

  test('[V1 PARITY] should preserve expression when updating formula timezone with partial options', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-timezone-partial',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
      if (!primaryFieldId) throw new Error('Primary field not found');

      const tableWithDate = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'date', name: 'event_date' },
      });
      const dateField = tableWithDate.fields.find((f) => f.name === 'event_date');
      if (!dateField) throw new Error('Date field not found');

      const expression = `DATETIME_FORMAT({${dateField.id}}, 'YYYY-MM-DD HH:mm:ss')`;
      const tableWithFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'formatted_date',
          options: {
            expression,
          },
        },
      });
      const formulaField = tableWithFormula.fields.find((f) => f.name === 'formatted_date');
      if (!formulaField) throw new Error('Formula field not found');

      await ctx.createRecords(tableId, [
        {
          fields: {
            [primaryFieldId]: 'row-1',
            [dateField.id]: '2024-06-15T14:30:00.000Z',
          },
        },
      ]);
      await ctx.drainOutbox();

      const recordsBefore = await ctx.listRecords(tableId);
      expect(recordsBefore[0]?.fields[formulaField.id]).toBe('2024-06-15 14:30:00');

      const updatedTable = await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          // Keep parity with UI partial payload: only timezone is sent.
          options: {
            timeZone: 'America/New_York',
          },
        },
      });
      await ctx.drainOutbox();

      const updatedFormulaField = updatedTable.fields.find((f) => f.id === formulaField.id);
      const updatedOptions = updatedFormulaField?.options as { expression?: string } | undefined;
      expect(updatedOptions?.expression).toBe(expression);

      const recordsAfter = await ctx.listRecords(tableId);
      expect(recordsAfter[0]?.fields[formulaField.id]).toBe('2024-06-15 10:30:00');
    } finally {
      if (tableId) {
        await ctx.deleteTable(tableId);
      }
    }
  });

  // ============ General property updates ============

  test('should update formula field name', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-rename',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'formulaField',
          options: { expression: '1 + 1' },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'formulaField');
      if (!formulaField) throw new Error('Formula field not found');

      const updatedTable = await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: { name: 'new formulaField' },
      });

      const updatedField = updatedTable.fields.find((f) => f.id === formulaField.id);
      const options = updatedField?.options as { expression?: string } | undefined;
      expect(updatedField?.name).toBe('new formulaField');
      expect(options?.expression).toBe('1 + 1');
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  // ============ Expression updates ============

  test('should update formula expression', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-update-expression',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
      if (!primaryFieldId) throw new Error('Primary field not found');

      const withNumber = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: 'N' },
      });
      const nField = withNumber.fields.find((f) => f.name === 'N');
      if (!nField) throw new Error('Number field not found');

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F',
          options: { expression: `{${nField.id}} + 1` },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'F');
      if (!formulaField) throw new Error('Formula field not found');

      await ctx.createRecords(tableId, [
        { fields: { [primaryFieldId]: 'r1', [nField.id]: 10 } },
        { fields: { [primaryFieldId]: 'r2', [nField.id]: 20 } },
      ]);
      await ctx.drainOutbox();

      await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: { expression: `{${nField.id}} * 2` },
        },
      });
      await ctx.drainOutbox();

      const records = await ctx.listRecords(tableId);
      const values = records
        .map((r) => r.fields[formulaField.id])
        .sort((a, b) => Number(a) - Number(b));
      expect(values).toEqual([20, 40]);
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('should not publish upstream source field updates when formula expression changes', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-update-no-upstream-record-update',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
      if (!primaryFieldId) throw new Error('Primary field not found');

      const withSource = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: 'Content' },
      });
      const sourceField = withSource.fields.find((f) => f.name === 'Content');
      if (!sourceField) throw new Error('Content field not found');

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'Formula',
          options: { expression: `{${sourceField.id}} + 1` },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'Formula');
      if (!formulaField) throw new Error('Formula field not found');

      const created = await ctx.createRecord(tableId, {
        [primaryFieldId]: 'r1',
        [sourceField.id]: 10,
      });
      await ctx.drainOutbox();

      const beforeEvents = (ctx.testContainer.eventBus.events() as ReadonlyArray<unknown>).length;
      ctx.testContainer.clearLogs();

      await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: { expression: `{${sourceField.id}} + 2` },
        },
      });
      await ctx.drainOutbox();

      const records = await ctx.listRecords(tableId);
      const row = records.find((r) => r.id === created.id);
      expect(row?.fields[sourceField.id]).toBe(10);
      expect(row?.fields[formulaField.id]).toBe(12);

      const plan = ctx.testContainer.getLastComputedPlan();
      if (plan) {
        const allStepFieldIds = plan.steps.flatMap((step) => step.fieldIds);
        expect(allStepFieldIds).toContain(formulaField.id);
        expect(allStepFieldIds).not.toContain(sourceField.id);
      }

      const backfillLogs = ctx.testContainer.spyLogger.getEntriesByMessage(
        'computed:backfillMany:start'
      );
      const hasFormulaBackfillWithoutSource = backfillLogs.some((entry) => {
        const context = entry.context;
        if (!isObjectRecord(context)) return false;
        const fieldIds = context['fieldIds'];
        if (!Array.isArray(fieldIds)) return false;
        const ids = fieldIds.filter((id): id is string => typeof id === 'string');
        return ids.includes(formulaField.id) && !ids.includes(sourceField.id);
      });
      expect(hasFormulaBackfillWithoutSource).toBe(true);

      const newEvents = (ctx.testContainer.eventBus.events() as ReadonlyArray<unknown>).slice(
        beforeEvents
      );
      const fieldScopedEvents = newEvents.filter(
        (event): event is DomainEventLike =>
          isObjectRecord(event) &&
          'name' in event &&
          isObjectRecord(event.name) &&
          typeof event.name.toString === 'function' &&
          'fieldId' in event
      );
      expect(fieldScopedEvents.some((event) => event.fieldId?.toString() === sourceField.id)).toBe(
        false
      );

      const recordsBatchEvents = newEvents.filter(
        (event): event is DomainEventLike =>
          isObjectRecord(event) &&
          'name' in event &&
          isObjectRecord(event.name) &&
          typeof event.name.toString === 'function' &&
          event.name.toString() === 'RecordsBatchUpdated'
      );

      const changedFieldIds = recordsBatchEvents.flatMap((event) => getBatchChangedFieldIds(event));
      expect(changedFieldIds).not.toContain(sourceField.id);
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('should update expression with new field reference', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-new-reference',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
      if (!primaryFieldId) throw new Error('Primary field not found');

      const withN1 = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: 'N1' },
      });
      const n1 = withN1.fields.find((f) => f.name === 'N1');
      if (!n1) throw new Error('N1 not found');

      const withN2 = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: 'N2' },
      });
      const n2 = withN2.fields.find((f) => f.name === 'N2');
      if (!n2) throw new Error('N2 not found');

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F',
          options: { expression: `{${n1.id}}` },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'F');
      if (!formulaField) throw new Error('Formula field not found');

      const record = await ctx.createRecord(tableId, {
        [primaryFieldId]: 'r1',
        [n1.id]: 10,
        [n2.id]: 5,
      });
      await ctx.drainOutbox();

      await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: { expression: `{${n1.id}} + {${n2.id}}` },
        },
      });
      await ctx.drainOutbox();

      const records = await ctx.listRecords(tableId);
      expect(records.find((r) => r.id === record.id)?.fields[formulaField.id]).toBe(15);
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('should update expression and change result type', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-change-result-type',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
      if (!primaryFieldId) throw new Error('Primary field not found');

      const withText = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'singleLineText', name: 'TextField' },
      });
      const textField = withText.fields.find((f) => f.name === 'TextField');
      if (!textField) throw new Error('TextField not found');

      const withNum = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: 'NumberField' },
      });
      const numberField = withNum.fields.find((f) => f.name === 'NumberField');
      if (!numberField) throw new Error('NumberField not found');

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F',
          options: { expression: `{${textField.id}}` },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'F');
      if (!formulaField) throw new Error('Formula field not found');

      await ctx.createRecords(tableId, [
        { fields: { [primaryFieldId]: 'r1', [textField.id]: 'a', [numberField.id]: 1 } },
        { fields: { [primaryFieldId]: 'r2', [textField.id]: 'b', [numberField.id]: 2 } },
      ]);
      await ctx.drainOutbox();

      const updatedTable = await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: { expression: `{${numberField.id}}` },
        },
      });
      await ctx.drainOutbox();

      const updatedField = updatedTable.fields.find((f) => f.id === formulaField.id) as
        | ({ cellValueType?: string } & typeof formulaField)
        | undefined;
      expect(updatedField?.cellValueType).toBe('number');

      const records = await ctx.listRecords(tableId);
      const values = records
        .map((r) => r.fields[formulaField.id])
        .sort((a, b) => Number(a) - Number(b));
      expect(values).toEqual([1, 2]);
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('should handle expression syntax error', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-invalid-expression',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F',
          options: { expression: '1 + 1' },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'F');
      if (!formulaField) throw new Error('Formula field not found');

      await expect(
        ctx.updateField({
          tableId,
          fieldId: formulaField.id,
          field: {
            type: 'formula',
            options: { expression: 'INVALID(' },
          },
        })
      ).rejects.toThrow();
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('should handle expression reference to deleted field', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-reference-deleted',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
      if (!primaryFieldId) throw new Error('Primary field not found');

      const withNumber = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: 'N' },
      });
      const nField = withNumber.fields.find((f) => f.name === 'N');
      if (!nField) throw new Error('N field not found');

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F',
          options: { expression: `{${nField.id}} + 1` },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'F');
      if (!formulaField) throw new Error('Formula field not found');

      await ctx.createRecord(tableId, {
        [primaryFieldId]: 'r1',
        [nField.id]: 1,
      });
      await ctx.drainOutbox();

      await ctx.deleteField({ tableId, fieldId: nField.id });
      await ctx.drainOutbox();

      const tableAfter = await ctx.getTableById(tableId);
      const afterField = tableAfter.fields.find((f) => f.id === formulaField.id) as
        | ({ hasError?: boolean } & typeof formulaField)
        | undefined;
      expect(afterField?.hasError).toBe(true);
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  // ============ Formatting updates ============

  test('should update number formatting', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-number-formatting',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F',
          options: {
            expression: '1 / 3',
            formatting: { type: 'decimal', precision: 2 },
          },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'F');
      if (!formulaField) throw new Error('Formula field not found');

      const updatedTable = await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: {
            expression: '1 / 3',
            formatting: { type: 'decimal', precision: 4 },
          },
        },
      });

      const updatedField = updatedTable.fields.find((f) => f.id === formulaField.id);
      const options = updatedField?.options as
        | { formatting?: { type?: string; precision?: number } }
        | undefined;
      expect(options?.formatting?.precision).toBe(4);
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('should update dateTime formatting', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-datetime-formatting',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const withDate = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'date', name: 'D' },
      });
      const dateField = withDate.fields.find((f) => f.name === 'D');
      if (!dateField) throw new Error('Date field not found');

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F',
          options: { expression: `{${dateField.id}}` },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'F');
      if (!formulaField) throw new Error('Formula field not found');

      const updatedTable = await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: {
            expression: `{${dateField.id}}`,
            formatting: {
              date: 'dateTime',
              time: 'HH:mm',
              timeZone: 'utc',
            },
          },
        },
      });

      const updatedField = updatedTable.fields.find((f) => f.id === formulaField.id);
      const options = updatedField?.options as
        | { formatting?: { date?: string; time?: string; timeZone?: string } }
        | undefined;
      expect(options?.formatting?.date).toBe('dateTime');
      expect(options?.formatting?.time).toBe('HH:mm');
      expect(options?.formatting?.timeZone).toBe('utc');
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  // ============ ShowAs updates ============

  test('should set showAs for number result', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-show-as',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F',
          options: {
            expression: '100',
          },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'F');
      if (!formulaField) throw new Error('Formula field not found');

      const updatedTable = await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: {
            expression: '100',
            showAs: { type: 'bar', color: 'green', showValue: true, maxValue: 100 },
          },
        },
      });

      const updatedField = updatedTable.fields.find((f) => f.id === formulaField.id);
      const options = updatedField?.options as
        | { showAs?: { type?: string; color?: string; showValue?: boolean; maxValue?: number } }
        | undefined;
      expect(options?.showAs?.type).toBe('bar');
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('[V1 PARITY] should clear showAs on formula update', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-clear-show-as',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const tableWithFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'formula_with_show_as',
          options: {
            expression: '"text"',
            showAs: { type: 'email' },
          },
        },
      });
      const formulaField = tableWithFormula.fields.find((f) => f.name === 'formula_with_show_as');
      if (!formulaField) throw new Error('Formula field not found');

      const updatedTable = await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: {
            expression: '"text"',
            showAs: null,
          },
        },
      });

      const updatedField = updatedTable.fields.find((f) => f.id === formulaField.id);
      const updatedOptions = updatedField?.options as
        | { expression?: string; timeZone?: string; showAs?: unknown }
        | undefined;

      expect(updatedOptions?.expression).toBe('"text"');
      expect(updatedOptions?.showAs).toBeUndefined();
    } finally {
      if (tableId) {
        await ctx.deleteTable(tableId);
      }
    }
  });

  // ============ Cascading updates ============

  test('should cascade changes to dependent fields', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-dependent-cascade',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
      if (!primaryFieldId) throw new Error('Primary field not found');

      const withN = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: 'N' },
      });
      const nField = withN.fields.find((f) => f.name === 'N');
      if (!nField) throw new Error('N field not found');

      const withF1 = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F1',
          options: { expression: `{${nField.id}} + 1` },
        },
      });
      const f1 = withF1.fields.find((f) => f.name === 'F1');
      if (!f1) throw new Error('F1 not found');

      const withF2 = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F2',
          options: { expression: `{${f1.id}} * 2` },
        },
      });
      const f2 = withF2.fields.find((f) => f.name === 'F2');
      if (!f2) throw new Error('F2 not found');

      const record = await ctx.createRecord(tableId, {
        [primaryFieldId]: 'r1',
        [nField.id]: 10,
      });
      await ctx.drainOutbox();

      await ctx.updateField({
        tableId,
        fieldId: f1.id,
        field: {
          type: 'formula',
          options: { expression: `{${nField.id}} * 3` },
        },
      });
      await ctx.drainOutbox();

      const records = await ctx.listRecords(tableId);
      const row = records.find((r) => r.id === record.id);
      expect(row?.fields[f1.id]).toBe(30);
      expect(row?.fields[f2.id]).toBe(60);
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });
});

describe('update-field: formula conversions', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('should convert formula to singleLineText with formatted output', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-formula-to-text',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;
      const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
      if (!primaryFieldId) throw new Error('Primary field not found');

      const withNumber = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: 'N' },
      });
      const nField = withNumber.fields.find((f) => f.name === 'N');
      if (!nField) throw new Error('Number field not found');

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F',
          options: {
            expression: `{${nField.id}} + 1`,
            formatting: { type: 'decimal', precision: 2 },
          },
        },
      });
      const formulaField = withFormula.fields.find((f) => f.name === 'F');
      if (!formulaField) throw new Error('Formula field not found');

      const record = await ctx.createRecord(tableId, {
        [primaryFieldId]: 'r1',
        [nField.id]: 12.5,
      });
      await ctx.drainOutbox();

      const updatedTable = await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: { type: 'singleLineText' },
      });

      const updatedField = updatedTable.fields.find((f) => f.id === formulaField.id);
      expect(updatedField?.type).toBe('singleLineText');

      const records = await ctx.listRecords(tableId);
      const value = records.find((r) => r.id === record.id)?.fields[formulaField.id];
      expect(typeof value).toBe('string');
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('should reject conversion to formula without expression', async () => {
    let tableId: string | undefined;
    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'v2-to-formula-without-expression',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const withText = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'singleLineText', name: 'Text Source' },
      });
      const textField = withText.fields.find((f) => f.name === 'Text Source');
      if (!textField) throw new Error('Text field not found');

      await expect(
        ctx.updateField({
          tableId,
          fieldId: textField.id,
          field: {
            type: 'formula',
          },
        })
      ).rejects.toThrow();
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });
});
