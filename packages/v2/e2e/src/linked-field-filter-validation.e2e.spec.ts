/* eslint-disable @typescript-eslint/naming-convention */
import {
  createFieldErrorResponseSchema,
  updateFieldErrorResponseSchema,
} from '@teable/v2-contract-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * Regression: a linked field's filter was accepted by the field API and only failed
 * later, in the background backfill ("Invalid record condition operator"), leaving a
 * dead letter. Both carriers of a linked filter are covered here: `rollup.config.filter`
 * and plain `lookup.options.filter`.
 *
 * Shape (no production identifiers or values): a host table --oneMany link--> a source
 * table. The source holds a scalar checkbox and a scalar singleLineText used as the
 * count source, with three child rows: checked, unchecked (written as false), and an
 * omitted checkbox (stored as NULL, T6520). The host row links all three children, so
 * the unfiltered `countall({values})` is 3 and every filter result is a real count.
 */
const INVALID_OPERATOR_CODE = 'field.condition.invalid_operator_for_field';

type CheckboxFilter = {
  conjunction: 'and';
  filterSet: Array<{ fieldId: string; operator: 'is' | 'isNot'; value: boolean | null }>;
};

type HttpResult = { status: number; body: unknown };

describe('create-field/update-field: linked field filter validation', () => {
  let ctx: SharedTestContext;
  let sourceTableId: string;
  let hostTableId: string;
  let sourcePrimaryFieldId: string;
  let flagFieldId: string;
  let noteFieldId: string;
  let hostPrimaryFieldId: string;
  let linkFieldId: string;
  let hostRecordId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    sourcePrimaryFieldId = createFieldId();
    flagFieldId = createFieldId();
    noteFieldId = createFieldId();
    const source = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Linked filter source',
      fields: [
        { type: 'singleLineText', id: sourcePrimaryFieldId, name: 'Label', isPrimary: true },
        { type: 'checkbox', id: flagFieldId, name: 'Flag' },
        { type: 'singleLineText', id: noteFieldId, name: 'Note' },
      ],
      records: [
        {
          fields: {
            [sourcePrimaryFieldId]: 'checked',
            [flagFieldId]: true,
            [noteFieldId]: 'note-checked',
          },
        },
        {
          fields: {
            [sourcePrimaryFieldId]: 'unchecked',
            [flagFieldId]: false,
            [noteFieldId]: 'note-unchecked',
          },
        },
        {
          fields: {
            [sourcePrimaryFieldId]: 'blank',
            [noteFieldId]: 'note-blank',
          },
        },
      ],
    });
    sourceTableId = source.id;

    hostPrimaryFieldId = createFieldId();
    linkFieldId = createFieldId();
    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Linked filter host',
      fields: [{ type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true }],
    });
    hostTableId = host.id;

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        id: linkFieldId,
        name: 'Children',
        options: {
          relationship: 'oneMany',
          foreignTableId: sourceTableId,
          lookupFieldId: sourcePrimaryFieldId,
        },
      },
    });

    const children = await ctx.listRecords(sourceTableId);
    const hostRecord = await ctx.createRecord(hostTableId, {
      [hostPrimaryFieldId]: 'Host',
      [linkFieldId]: children.map((child) => ({ id: child.id })),
    });
    hostRecordId = hostRecord.id;
    await ctx.drainOutbox();
  });

  afterAll(async () => {
    if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
    if (sourceTableId) await ctx.deleteTable(sourceTableId).catch(() => undefined);
  });

  const checkboxFilter = (operator: 'is' | 'isNot', value: boolean | null): CheckboxFilter => ({
    conjunction: 'and',
    filterSet: [{ fieldId: flagFieldId, operator, value }],
  });

  const postJson = async (path: string, body: unknown): Promise<HttpResult> => {
    const response = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as unknown };
  };

  const expectInvalidOperatorRejection = (
    schema: typeof updateFieldErrorResponseSchema,
    result: HttpResult
  ) => {
    expect(result.status, JSON.stringify(result.body)).toBe(400);
    const parsed = schema.safeParse(result.body);
    expect(parsed.success, JSON.stringify(result.body)).toBe(true);
    if (!parsed.success) throw new Error('Unexpected error response shape');
    expect(parsed.data.error.code).toBe(INVALID_OPERATOR_CODE);
    expect(parsed.data.error.message).toMatch(/invalid record condition operator/i);
  };

  // A rejected request must not queue work, and a queued filter that cannot be
  // evaluated must show up here as the reported dead letter rather than as a status
  // assertion. The throw is captured, not swallowed: the caller asserts it apart.
  const drainCapturingError = async () =>
    ctx.drainOutbox().then(
      () => undefined,
      (error: unknown) => error
    );

  const readFixtureDeadLetters = async (fieldIds: string[] = []) => {
    const fixtureTableIds = new Set([hostTableId, sourceTableId]);
    const rows = await ctx.testContainer.db
      .selectFrom('computed_update_dead_letter')
      .select(['id', 'last_error', 'affected_table_ids', 'affected_field_ids'])
      .where('base_id', '=', ctx.baseId)
      .execute();
    return rows.filter(
      (row) =>
        (row.affected_table_ids ?? []).some((tableId) => fixtureTableIds.has(tableId)) ||
        fieldIds.some((fieldId) => (row.affected_field_ids ?? []).includes(fieldId))
    );
  };

  const hostRecordValue = async (fieldId: string) => {
    const records = await ctx.listRecords(hostTableId);
    return records.find((record) => record.id === hostRecordId)?.fields[fieldId];
  };

  const lookupValues = async (fieldId: string) => {
    const value = await hostRecordValue(fieldId);
    if (Array.isArray(value)) return value;
    return value == null ? [] : [value];
  };

  const createCountRollup = async (fieldId: string, name: string) => {
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'rollup',
        id: fieldId,
        name,
        options: { expression: 'countall({values})' },
        config: {
          linkFieldId,
          foreignTableId: sourceTableId,
          lookupFieldId: noteFieldId,
        },
      },
    });
  };

  test('rollup: rejects a checkbox isNot filter on update', async () => {
    const rollupFieldId = createFieldId();
    await createCountRollup(rollupFieldId, 'Matched note count');
    try {
      expect(await hostRecordValue(rollupFieldId)).toBe(3);

      // The reported entry point is the field API, not a raw row write: a checkbox only
      // supports `is`, so `isNot` with a non-null value can never be evaluated.
      const invalid = await postJson('/tables/updateField', {
        tableId: hostTableId,
        fieldId: rollupFieldId,
        field: {
          config: {
            linkFieldId,
            foreignTableId: sourceTableId,
            lookupFieldId: noteFieldId,
            filter: checkboxFilter('isNot', true),
          },
        },
      });

      // Observe the queue before judging the response: the defect surfaced as a failed
      // backfill, so asserting only the status would describe the fix, not the failure.
      const drainError = await drainCapturingError();
      const deadLetters = await readFixtureDeadLetters([rollupFieldId]);
      expect(deadLetters.map((deadLetter) => deadLetter.last_error)).toEqual([]);
      expect(drainError).toBeUndefined();

      expectInvalidOperatorRejection(updateFieldErrorResponseSchema, invalid);

      const table = await ctx.getTableById(hostTableId);
      const field = table.fields.find((candidate) => candidate.id === rollupFieldId);
      if (field?.type !== 'rollup') throw new Error('Rollup field missing after rejection');
      expect(field.config.filter ?? null).toBeNull();
      expect(await hostRecordValue(rollupFieldId)).toBe(3);
    } finally {
      await ctx
        .deleteField({ tableId: hostTableId, fieldId: rollupFieldId })
        .catch(() => undefined);
    }
  });

  test('rollup: counts only the rows a valid checkbox filter matches', async () => {
    const rollupFieldId = createFieldId();
    await createCountRollup(rollupFieldId, 'Filtered note count');
    try {
      const applyFilter = async (filter: CheckboxFilter) => {
        await ctx.updateField({
          tableId: hostTableId,
          fieldId: rollupFieldId,
          field: {
            config: {
              linkFieldId,
              foreignTableId: sourceTableId,
              lookupFieldId: noteFieldId,
              filter,
            },
          },
        });
        await ctx.drainOutbox();
        return hostRecordValue(rollupFieldId);
      };

      expect(await applyFilter(checkboxFilter('is', true))).toBe(1);
      // Unchecked checkboxes are stored as null (T6520) and `is false` matches both
      // false and null, so the explicit false child and the omitted one both count.
      expect(await applyFilter(checkboxFilter('is', false))).toBe(2);
      // Legacy v1 shape for "checked": isNot + null must stay accepted.
      expect(await applyFilter(checkboxFilter('isNot', null))).toBe(1);
    } finally {
      await ctx
        .deleteField({ tableId: hostTableId, fieldId: rollupFieldId })
        .catch(() => undefined);
    }
  });

  test('rollup: rejects a checkbox isNot filter on create', async () => {
    const invalid = await postJson('/tables/createField', {
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'rollup',
        name: 'Invalid filtered count',
        options: { expression: 'countall({values})' },
        config: {
          linkFieldId,
          foreignTableId: sourceTableId,
          lookupFieldId: noteFieldId,
          filter: checkboxFilter('isNot', false),
        },
      },
    });

    const drainError = await drainCapturingError();
    const deadLetters = await readFixtureDeadLetters();
    expect(deadLetters.map((deadLetter) => deadLetter.last_error)).toEqual([]);
    expect(drainError).toBeUndefined();

    expectInvalidOperatorRejection(createFieldErrorResponseSchema, invalid);

    const table = await ctx.getTableById(hostTableId);
    expect(table.fields.find((field) => field.name === 'Invalid filtered count')).toBeUndefined();
  });

  test('lookup: rejects a checkbox isNot filter on create and update', async () => {
    const invalidCreate = await postJson('/tables/createField', {
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'lookup',
        name: 'Invalid filtered lookup',
        options: {
          linkFieldId,
          foreignTableId: sourceTableId,
          lookupFieldId: noteFieldId,
          filter: checkboxFilter('isNot', true),
        },
      },
    });

    const createDrainError = await drainCapturingError();
    const createDeadLetters = await readFixtureDeadLetters();
    expect(createDeadLetters.map((deadLetter) => deadLetter.last_error)).toEqual([]);
    expect(createDrainError).toBeUndefined();

    expectInvalidOperatorRejection(createFieldErrorResponseSchema, invalidCreate);

    const afterRejection = await ctx.getTableById(hostTableId);
    expect(
      afterRejection.fields.find((field) => field.name === 'Invalid filtered lookup')
    ).toBeUndefined();

    const lookupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Filtered notes',
        options: {
          linkFieldId,
          foreignTableId: sourceTableId,
          lookupFieldId: noteFieldId,
          filter: checkboxFilter('is', true),
        },
      },
    });
    try {
      expect(await lookupValues(lookupFieldId)).toEqual(['note-checked']);

      const invalidUpdate = await postJson('/tables/updateField', {
        tableId: hostTableId,
        fieldId: lookupFieldId,
        field: { options: { filter: checkboxFilter('isNot', true) } },
      });

      const updateDrainError = await drainCapturingError();
      const updateDeadLetters = await readFixtureDeadLetters([lookupFieldId]);
      expect(updateDeadLetters.map((deadLetter) => deadLetter.last_error)).toEqual([]);
      expect(updateDrainError).toBeUndefined();

      expectInvalidOperatorRejection(updateFieldErrorResponseSchema, invalidUpdate);

      const table = await ctx.getTableById(hostTableId);
      const persisted = table.fields.find((field) => field.id === lookupFieldId);
      expect(persisted?.lookupOptions?.filter).toMatchObject({
        conjunction: 'and',
        filterSet: [{ fieldId: flagFieldId, operator: 'is', value: true }],
      });
      expect(await lookupValues(lookupFieldId)).toEqual(['note-checked']);

      // Legacy v1 "checked" shape: isNot + null still folds to is true.
      await ctx.updateField({
        tableId: hostTableId,
        fieldId: lookupFieldId,
        field: { options: { filter: checkboxFilter('isNot', null) } },
      });
      await ctx.drainOutbox();
      expect(await lookupValues(lookupFieldId)).toEqual(['note-checked']);
    } finally {
      await ctx
        .deleteField({ tableId: hostTableId, fieldId: lookupFieldId })
        .catch(() => undefined);
    }
  });
});
