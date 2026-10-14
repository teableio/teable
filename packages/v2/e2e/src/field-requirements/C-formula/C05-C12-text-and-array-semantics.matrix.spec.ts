/**
 * C05 / C12 — text indexing and array ordering semantics.
 *
 * These are the two open questions the requirement document raises:
 * C05 asks whether `LEN` counts characters, code points or UTF-16 units, and
 * whether `FIND`/`SEARCH` are 1-based; C12 asks how `ARRAY_JOIN`, `ARRAY_UNIQUE`,
 * `ARRAY_FLATTEN` and `ARRAY_COMPACT` treat separators, nesting, duplicates,
 * order and falsy-looking values.
 *
 * The assertions below are the observed v2 contract, exercised end to end
 * through a real formula field so the interpreter and the SQL lowering are
 * both covered.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

type FormulaCase = {
  /** Requirement-facing label; `$`-prefixed so `it.each` can interpolate it. */
  readonly label: string;
  readonly expression: string;
  readonly expected: unknown;
};

describe('C05/C12: text indexing and array semantics', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let recordId: string;
  const ids: Record<string, string> = {};
  /** label -> fieldId for every formula field under test. */
  const formulaIds = new Map<string, string>();

  const literalCases: ReadonlyArray<FormulaCase> = [
    // C05 — index base and length counting.
    { label: 'LEN counts code points for CJK', expression: 'LEN("中文")', expected: 2 },
    { label: 'LEN counts a surrogate pair as one', expression: 'LEN("🚀")', expected: 1 },
    { label: 'LEN of an empty string is 0', expression: 'LEN("")', expected: 0 },
    { label: 'FIND is 1-based', expression: 'FIND("b", "abc")', expected: 2 },
    {
      label: 'FIND returns 0 when the needle is absent',
      expression: 'FIND("z", "abc")',
      expected: 0,
    },
    { label: 'MID is 1-based', expression: 'MID("abcdef", 1, 2)', expected: 'ab' },
    {
      label: 'MID clamps a 0 start to the first character',
      expression: 'MID("abcdef", 0, 2)',
      expected: 'a',
    },
    { label: 'LEFT supports a zero length', expression: 'LEFT("abcdef", 0)', expected: '' },
    {
      label: 'TRIM keeps internal runs of spaces',
      expression: 'TRIM("  a  b  ")',
      expected: 'a  b',
    },
    { label: 'T passes text through', expression: 'T("abc")', expected: 'abc' },

    // C05 — the two functions absent from every other e2e spec.
    {
      label: 'TEXTBEFORE returns the prefix before the first match',
      expression: 'TEXTBEFORE("a-b-c", "-")',
      expected: 'a',
    },
    {
      label: 'TEXTSPLIT splits on the column delimiter',
      expression: 'TEXTSPLIT("a,b,c", ",")',
      expected: ['a', 'b', 'c'],
    },
    {
      label: 'TEXTSPLIT returns the rows before the row delimiter',
      expression: 'TEXTSPLIT("a|b", "|", ",")',
      expected: ['a', 'b'],
    },

    // C04 — sign and domain behaviour the document leaves open.
    {
      label: 'ROUND rounds halves away from zero on negatives',
      expression: 'ROUND(-2.5, 0)',
      expected: -3,
    },
    { label: 'INT floors instead of truncating', expression: 'INT(-2.5)', expected: -3 },
    { label: 'MOD keeps the dividend sign', expression: 'MOD(-7, 3)', expected: -1 },

    // C06 — truthiness.
    { label: 'IF treats BLANK as false', expression: 'IF(BLANK(), "y", "n")', expected: 'n' },
    { label: 'IF treats 0 as false', expression: 'IF(0, "y", "n")', expected: 'n' },
    { label: 'IF treats an empty string as false', expression: 'IF("", "y", "n")', expected: 'n' },
    { label: 'NOT of BLANK is true', expression: 'NOT(BLANK())', expected: true },
    {
      label: 'SWITCH allows mixed branch result types',
      expression: 'SWITCH("b", "a", 1, "b", "two")',
      expected: 'two',
    },

    // C07 — empty versus error.
    { label: 'BLANK is an empty result, not an error', expression: 'BLANK()', expected: null },
    { label: 'IS_ERROR detects a produced error', expression: 'IS_ERROR(ERROR())', expected: true },

    // C11 — the three counting functions disagree on their inputs.
    { label: 'COUNTA ignores an empty string argument', expression: 'COUNTA("")', expected: 0 },
    { label: 'COUNTALL counts an empty string argument', expression: 'COUNTALL("")', expected: 1 },
    { label: 'COUNT skips blank arguments', expression: 'COUNT(1, "x", BLANK())', expected: 2 },
  ];

  const referenceCases: ReadonlyArray<FormulaCase> = [
    // C06 with field references.
    {
      label: 'AND combines a checked box with the TRUE literal',
      expression: 'AND({Chk}, TRUE)',
      expected: true,
    },
    {
      label: 'OR combines a checked box with the FALSE literal',
      expression: 'OR({Chk}, FALSE)',
      expected: true,
    },
    {
      label: 'XOR of a checked box and an empty one is true',
      expression: 'XOR({Chk}, {Chk2})',
      expected: true,
    },
    { label: 'NOT of a checked box is false', expression: 'NOT({Chk})', expected: false },
    { label: 'IF a checked box', expression: 'IF({Chk}, "y", "n")', expected: 'y' },

    // C12 with multi-select references.
    {
      label: 'ARRAY_JOIN uses the given separator',
      expression: 'ARRAYJOIN({Msel}, ",")',
      expected: 'A,B',
    },
    {
      label: 'ARRAY_UNIQUE de-duplicates across inputs keeping first-seen order',
      expression: 'ARRAYUNIQUE({Msel}, {Msel2})',
      expected: ['A', 'B', 'C'],
    },
    {
      label: 'ARRAY_FLATTEN concatenates without de-duplicating',
      expression: 'ARRAYFLATTEN({Msel}, {Msel2})',
      expected: ['A', 'B', 'B', 'C'],
    },
    {
      label: 'ARRAY_COMPACT keeps the populated values',
      expression: 'ARRAYCOMPACT({Msel})',
      expected: ['A', 'B'],
    },
    {
      label: 'COUNTALL over a multi-select counts the elements',
      expression: 'COUNTALL({Msel})',
      expected: 2,
    },
    {
      label: 'COUNTA over a multi-select counts the elements',
      expression: 'COUNTA({Msel})',
      expected: 2,
    },
    {
      label: 'COUNT over a multi-select counts the elements',
      expression: 'COUNT({Msel})',
      expected: 2,
    },
  ];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'C05 Text And Array',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'checkbox', name: 'Chk' },
        { type: 'checkbox', name: 'Chk2' },
        {
          type: 'multipleSelect',
          name: 'Msel',
          options: { choices: [{ name: 'A' }, { name: 'B' }] },
        },
        {
          type: 'multipleSelect',
          name: 'Msel2',
          options: { choices: [{ name: 'B' }, { name: 'C' }] },
        },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    for (const field of table.fields) ids[field.name] = field.id;

    const createFormula = async (label: string, expression: string) => {
      const withReferences = expression.replace(
        /\{([A-Z0-9]+)\}/gi,
        (_match, name: string) => `{${ids[name]}}`
      );
      const updated = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: label,
          options: { expression: withReferences },
        },
      });
      formulaIds.set(label, fieldByName(updated, label).id);
    };

    for (const testCase of [...literalCases, ...referenceCases]) {
      await createFormula(testCase.label, testCase.expression);
    }

    const record = await ctx.createRecord(tableId, {
      [ids.Chk]: true,
      [ids.Chk2]: null,
      [ids.Msel]: ['A', 'B'],
      [ids.Msel2]: ['B', 'C'],
    });
    recordId = record.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const assertCase = async ({ label, expected }: FormulaCase) => {
    const fieldId = formulaIds.get(label);
    expect(fieldId, `formula field for "${label}" was not created`).toBeTruthy();
    await expect(readValue(ctx, tableId, recordId, fieldId as string)).resolves.toEqual(expected);
  };

  describe('C05/C04/C06/C07/C11 literal expressions', () => {
    it.each(literalCases)('$label', assertCase);
  });

  describe('C06/C12 field-reference expressions', () => {
    it.each(referenceCases)('$label', assertCase);
  });
});
