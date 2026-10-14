/**
 * C03 — missing required parameters, non-convertible types and syntax errors
 * are locatable.
 *
 * C03 (实现依据): parameter validation runs during AST parsing and the message
 * must name the function, so a user can find it. The cases below confirm that
 * for missing parameters and syntax errors.
 *
 * Two of the document's sub-items get a concrete answer here:
 *
 * 1. "无法转换的类型" is **not** upheld for literals. A numeric-only function fed
 *    a non-numeric literal is accepted at configuration time
 *    (`SUM("not a number")` creates the field) and the bad type never gets a
 *    located error — it just reads back empty. Recorded as a gap.
 * 2. "多余参数源码注释允许忽略，需确认产品设计" is answered by the implementation,
 *    not by the comment: extra arguments are **rejected** with a message naming
 *    the function (`LEN only allow 1 param`). The source comment the document
 *    cites is stale; the strict behaviour is the one users get.
 *
 * Case tables are built inside `beforeAll` on purpose: a field id is only known
 * after the table exists, and an expression built earlier would interpolate
 * `undefined` and fail for the wrong reason.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

type RejectionCase = {
  /** Requirement-facing label used in the test title. */
  readonly label: string;
  /** Formula source sent to `createField`. */
  readonly expression: string;
  /**
   * Fragment the error must contain. Only set where the message is stable and
   * part of the requirement (C03 asks for the function name).
   */
  readonly expectMatch?: RegExp;
};

type AcceptanceCase = {
  readonly label: string;
  readonly expression: string;
  /** Why accepting this is recorded as a gap rather than as correct behaviour. */
  readonly gap: string;
};

describe('C03: formula argument and syntax errors', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let numberId: string;
  let dateId: string;
  let seq = 0;

  let missingParameterCases: RejectionCase[] = [];
  let syntaxCases: RejectionCase[] = [];
  let acceptedCases: AcceptanceCase[] = [];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'C03 Argument Errors',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Number' },
        { type: 'date', name: 'Date' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    numberId = fieldByName(table, 'Number').id;
    dateId = fieldByName(table, 'Date').id;

    missingParameterCases = [
      {
        label: 'IF without its false branch',
        expression: 'IF(1, 1)',
        expectMatch: /IF needs at least/i,
      },
      {
        label: 'ROUND with no argument',
        expression: 'ROUND()',
        expectMatch: /ROUND needs at least/i,
      },
      {
        label: 'CONCATENATE with no argument',
        expression: 'CONCATENATE()',
        expectMatch: /CONCATENATE needs at least/i,
      },
      {
        label: 'FROMNOW without a unit',
        expression: `FROMNOW({${dateId}})`,
        expectMatch: /FROMNOW needs at least/i,
      },
      {
        label: 'TONOW without a unit',
        expression: `TONOW({${dateId}})`,
        expectMatch: /TONOW needs at least/i,
      },
    ];

    syntaxCases = [
      {
        label: 'an unregistered function name',
        expression: `INVALID_FUNCTION({${numberId}})`,
        expectMatch: /INVALID_FUNCTION/,
      },
      { label: 'an unbalanced parenthesis', expression: 'SUM(1, 2' },
      { label: 'a trailing operator', expression: '1 +' },
      { label: 'an extra closing parenthesis', expression: 'SUM(1, 2))' },
      { label: 'an empty expression', expression: '' },
      {
        label: 'a reference to a field that does not exist',
        expression: 'SUM({fldDoesNotExist000000})',
        expectMatch: /do not exist/i,
      },
    ];

    acceptedCases = [
      {
        label: 'a numeric-only function fed a non-numeric literal',
        expression: 'SUM("not a number")',
        gap: 'C03 asks for non-convertible types to be reported; a literal is accepted here, so the bad type only shows up as an evaluation result.',
      },
    ];
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const createFormula = async (expression: string) => {
    seq += 1;
    const name = `C03-${seq}`;
    try {
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'formula', name, options: { expression } },
      });
      return { ok: true as const, message: '', fieldId: fieldByName(created, name).id };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message, fieldId: '' };
    }
  };

  describe('C03 missing required parameters', () => {
    it.each([0, 1, 2, 3, 4])(
      'rejects case %i with a message naming the function',
      async (index) => {
        const testCase = missingParameterCases[index];
        const result = await createFormula(testCase.expression);
        expect(result.ok, `${testCase.expression} should be rejected`).toBe(false);
        if (result.ok) return;
        if (testCase.expectMatch) expect(result.message).toMatch(testCase.expectMatch);
      }
    );
  });

  describe('C03 syntax errors', () => {
    it.each([0, 1, 2, 3, 4, 5])('rejects case %i', async (index) => {
      const testCase = syntaxCases[index];
      const result = await createFormula(testCase.expression);
      expect(result.ok, `${JSON.stringify(testCase.expression)} should be rejected`).toBe(false);
      if (result.ok) return;
      if (testCase.expectMatch) expect(result.message).toMatch(testCase.expectMatch);
    });

    it('echoes the offending source so the failure is locatable', async () => {
      const expression = `INVALID_FUNCTION({${numberId}})`;
      const result = await createFormula(expression);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // Without this the user only sees "invalid formula".
      expect(result.message).toContain('INVALID_FUNCTION');
    });
  });

  describe('C03 accepted at configuration time, so the error is not located', () => {
    it.each([0])('accepts case %i', async (index) => {
      const testCase = acceptedCases[index];
      const result = await createFormula(testCase.expression);
      // Recorded as the current behaviour. Each case carries the reason it is a
      // gap in `acceptedCases`, so this is a characterisation, not a verdict.
      expect(result.ok, `${testCase.expression} — ${result.ok ? '' : result.message}`).toBe(true);
    });

    it('the numeric literal case produces a field that reads back empty', async () => {
      const result = await createFormula('SUM("not a number")');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const record = await ctx.createRecord(tableId, {});
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      const row = rows.find((candidate) => candidate.id === record.id);
      // Not an error state and not a number: the configuration was accepted, so
      // the bad type has nowhere to be reported.
      expect(row?.fields[result.fieldId] ?? null).toBeNull();
    });
  });

  /**
   * The document records the source comment "多余参数源码注释允许忽略" and asks the
   * product to confirm. The implementation is stricter than the comment, so this
   * group pins the behaviour users actually get.
   */
  describe('C03 extra parameters are rejected, not silently ignored', () => {
    const extraParameterCases = (): RejectionCase[] => [
      {
        label: 'a one-argument text function',
        expression: 'LEN("abc", "extra")',
        expectMatch: /LEN only allow 1 param/i,
      },
      {
        label: 'a one-argument date function',
        expression: `YEAR({${dateId}}, "extra")`,
        expectMatch: /YEAR only allow 1 param/i,
      },
    ];

    it.each([0, 1])('rejects case %i with a message naming the function', async (index) => {
      const testCase = extraParameterCases()[index];
      const result = await createFormula(testCase.expression);
      expect(result.ok, `${testCase.expression} should be rejected`).toBe(false);
      if (result.ok) return;
      if (testCase.expectMatch) expect(result.message).toMatch(testCase.expectMatch);
    });
  });

  describe('C03 a valid expression still works', () => {
    it('accepts a numeric function over a numeric field', async () => {
      const result = await createFormula(`SUM({${numberId}}) + 1`);
      expect(result.ok).toBe(true);
    });
  });
});
