/**
 * R06 / R07 / R08 / R09 — which rollup function each target type may use.
 *
 * R06 (实现依据): a rollup's function is validated against the *value type* of
 * the referenced field, so string targets can never borrow the numeric
 * aggregates.
 * R07/R08/R09 (实现依据): the base set plus the type-specific additions from the
 * requirement document, asserted exhaustively in both directions.
 *
 * `max({values})` and `min({values})` are deliberately legal for both numbers
 * and dates; the table below is the authority, not the function name.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { getRollupFunctionsByCellValueType, type CellValueType } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

/** R07 — available to every value type. */
const BASE = [
  'countall({values})',
  'counta({values})',
  'count({values})',
  'array_join({values})',
  'array_unique({values})',
  'array_compact({values})',
  'concatenate({values})',
] as const;

/** R08 — numeric-only arithmetic. */
const NUMERIC_ONLY = ['sum({values})', 'average({values})'] as const;

/** R08 — legal for numbers and dates alike. */
const ORDERED = ['max({values})', 'min({values})'] as const;

/** R09 — boolean-only logical aggregates. */
const BOOLEAN_ONLY = ['and({values})', 'or({values})', 'xor({values})'] as const;

const ALL_EXPRESSIONS = [...BASE, ...NUMERIC_ONLY, ...ORDERED, ...BOOLEAN_ONLY] as const;

/** The requirement document's per-type capability table. */
const EXPECTED_BY_TYPE = {
  string: [...BASE],
  number: [...BASE, ...NUMERIC_ONLY, ...ORDERED],
  dateTime: [...BASE, ...ORDERED],
  boolean: [...BASE, ...BOOLEAN_ONLY],
} as const;

type TargetCase = {
  /** Requirement-facing label. */
  readonly rule: string;
  /** Field on the foreign table the rollup reads. */
  readonly foreignField: string;
  /** Value type the core must resolve for that field. */
  readonly valueType: string;
  readonly allowed: ReadonlyArray<string>;
};

const targetCases: ReadonlyArray<TargetCase> = [
  {
    rule: 'R07 string target keeps only the base set',
    foreignField: 'Text',
    valueType: 'string',
    allowed: EXPECTED_BY_TYPE.string,
  },
  {
    rule: 'R08 number target adds sum/average and keeps max/min',
    foreignField: 'Number',
    valueType: 'number',
    allowed: EXPECTED_BY_TYPE.number,
  },
  {
    rule: 'R08 date target adds max/min but not sum/average',
    foreignField: 'Date',
    valueType: 'dateTime',
    allowed: EXPECTED_BY_TYPE.dateTime,
  },
  {
    rule: 'R09 checkbox target adds and/or/xor',
    foreignField: 'Checkbox',
    valueType: 'boolean',
    allowed: EXPECTED_BY_TYPE.boolean,
  },
];

describe('R06–R09: rollup function availability by target value type', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let foreignTableId: string;
  let linkFieldId: string;
  const foreignIds: Record<string, string> = {};
  let fieldSeq = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'R07 Rollup Foreign',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text' },
        { type: 'number', name: 'Number', options: { defaultValue: 1 } },
        { type: 'date', name: 'Date', options: { defaultValue: 'now' } },
        { type: 'checkbox', name: 'Checkbox', options: { defaultValue: true } },
      ],
      views: [{ type: 'grid' }],
    });
    foreignTableId = foreign.id;
    for (const field of foreign.fields) foreignIds[field.name] = field.id;
    await ctx.createRecord(foreignTableId, {});

    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'R07 Rollup Host',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          name: 'Link',
          options: {
            relationship: 'manyMany',
            foreignTableId,
            lookupFieldId: foreignIds.Title,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = host.id;
    linkFieldId = fieldByName(host, 'Link').id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
  });

  const createRollup = async (expression: string, lookupFieldId: string) => {
    fieldSeq += 1;
    const name = `Rollup-${fieldSeq}`;
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'rollup',
        name,
        options: { expression },
        config: { linkFieldId, foreignTableId, lookupFieldId },
      },
    });
    return name;
  };

  describe.each(targetCases)('$rule', ({ foreignField, valueType, allowed }) => {
    const allowedSet = new Set<string>(allowed);
    const rejected = ALL_EXPRESSIONS.filter((expression) => !allowedSet.has(expression));

    it.each([...allowedSet])('accepts %s', async (expression) => {
      const name = await createRollup(expression, foreignIds[foreignField]);
      expect(name).toBeTruthy();
    });

    it.each(rejected)('rejects %s', async (expression) => {
      await expect(createRollup(expression, foreignIds[foreignField])).rejects.toThrow(
        new RegExp(
          valueType === 'string' ? 'rollup|not supported|Invalid' : 'not supported|Invalid',
          'i'
        )
      );
    });
  });

  describe('the capability table matches the core helper', () => {
    it.each(targetCases)(
      '$rule via getRollupFunctionsByCellValueType',
      ({ valueType, allowed }) => {
        const resolved = getRollupFunctionsByCellValueType({
          toString: () => valueType,
        } as unknown as CellValueType);
        expect([...resolved].sort()).toEqual([...allowed].sort());
      }
    );
  });

  it('R07 rejects an expression that is not a registered rollup function', async () => {
    await expect(createRollup('median({values})', foreignIds.Number)).rejects.toThrow();
  });
});
