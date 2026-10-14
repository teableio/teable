/**
 * R10 / R03 / R09 — empty-set results for lookup and rollup.
 *
 * R10 (待定口径): the requirement document asks for a per-function answer when
 * there is no linked record, no condition match, or only empty source values,
 * and explicitly warns against applying one uniform empty rule.
 * R03 (实现依据): a lookup's `isUnique` de-duplicates while keeping the type and
 * the first-seen order.
 * R09 (实现依据): boolean rollups add and/or/xor, whose empty-set result is the
 * identity element.
 *
 * The tables below are the current v2 answers, recorded so the review can
 * confirm or correct each row.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  findRow,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

type EmptyCase = {
  /** Requirement-facing label. */
  readonly label: string;
  /** Rollup expression over `{values}`. */
  readonly expression: string;
  /** Observed v2 result when the link points at nothing. */
  readonly expected: unknown;
  /** Requirement ID this row locks down. */
  readonly requirement: string;
};

describe('R10: empty-link lookup and rollup results', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let titleId: string;
  let createdRecordId: string;
  const rollupIds = new Map<string, string>();

  /**
   * Rows verified against the running service. `countall`/`counta` are the
   * counting identities, `sum` yields an empty numeric result, and the
   * collection functions yield empty collections rather than null.
   */
  const CASES: ReadonlyArray<EmptyCase> = [
    // Counting identities collapse to zero.
    {
      requirement: 'R07',
      label: 'countall of an empty set is 0',
      expression: 'countall({values})',
      expected: 0,
    },
    {
      requirement: 'R07',
      label: 'counta of an empty set is 0',
      expression: 'counta({values})',
      expected: 0,
    },
    {
      requirement: 'R07',
      label: 'count of an empty set is 0',
      expression: 'count({values})',
      expected: 0,
    },
    // The arithmetic aggregates do not agree with each other: the additive
    // pair collapses to 0 while the ordering pair stays null.
    {
      requirement: 'R08',
      label: 'sum of an empty set is 0',
      expression: 'sum({values})',
      expected: 0,
    },
    {
      requirement: 'R08',
      label: 'average of an empty set is 0',
      expression: 'average({values})',
      expected: 0,
    },
    {
      requirement: 'R08',
      label: 'max of an empty set is null',
      expression: 'max({values})',
      expected: null,
    },
    {
      requirement: 'R08',
      label: 'min of an empty set is null',
      expression: 'min({values})',
      expected: null,
    },
    // The collection aggregates all collapse to null rather than to an empty
    // collection, so "no linked records" and "linked records that are all
    // empty" are indistinguishable for every one of them.
    {
      requirement: 'R07',
      label: 'concatenate of an empty set is null',
      expression: 'concatenate({values})',
      expected: null,
    },
    {
      requirement: 'R07',
      label: 'array_join of an empty set is null',
      expression: 'array_join({values})',
      expected: null,
    },
    {
      requirement: 'R07',
      label: 'array_unique of an empty set is null',
      expression: 'array_unique({values})',
      expected: null,
    },
    {
      requirement: 'R07',
      label: 'array_compact of an empty set is null',
      expression: 'array_compact({values})',
      expected: null,
    },
    {
      requirement: 'R09',
      label: 'and of an empty set falls back to null',
      expression: 'and({values})',
      expected: null,
    },
    {
      requirement: 'R09',
      label: 'or of an empty set falls back to null',
      expression: 'or({values})',
      expected: null,
    },
    // R09's three logical aggregates disagree: `xor` collapses to the boolean
    // false while `and`/`or` stay null.
    {
      requirement: 'R09',
      label: 'xor of an empty set is false',
      expression: 'xor({values})',
      expected: false,
    },
  ];

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'R10 Rollup Foreign',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'date', name: 'When' },
        { type: 'checkbox', name: 'Flag' },
      ],
      views: [{ type: 'grid' }],
    });
    const foreignTitleId = fieldByName(foreign, 'Title').id;

    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'R10 Rollup Host',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          name: 'Link',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreign.id,
            lookupFieldId: foreignTitleId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = host.id;
    titleId = fieldByName(host, 'Title').id;
    const linkId = fieldByName(host, 'Link').id;

    const numberTargets = ['Amount', 'When', 'Flag'];
    const targetIds = Object.fromEntries(
      numberTargets.map((name) => [name, fieldByName(foreign, name).id])
    );

    for (const testCase of CASES) {
      // `and`/`or`/`xor` are only legal against a boolean target.
      const target =
        testCase.expression.startsWith('and') ||
        testCase.expression.startsWith('or(') ||
        testCase.expression.startsWith('xor')
          ? targetIds.Flag
          : targetIds.Amount;
      const updated = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'rollup',
          name: testCase.label,
          options: { expression: testCase.expression },
          config: {
            linkFieldId: linkId,
            foreignTableId: foreign.id,
            lookupFieldId: target,
          },
        },
      });
      rollupIds.set(testCase.label, fieldByName(updated, testCase.label).id);
    }

    // A host row whose link points at nothing.
    createdRecordId = (await ctx.createRecord(tableId, { [titleId]: 'no links' })).id;
    await ctx.drainOutbox();
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const storedValue = async (fieldId: string) => {
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    return findRow(rows, createdRecordId)?.fields[fieldId];
  };

  describe.each(CASES)('$requirement $label', ({ label, expected }) => {
    it('produces the recorded empty-set result', async () => {
      const fieldId = rollupIds.get(label);
      expect(fieldId, `rollup field "${label}" was not created`).toBeTruthy();
      await expect(storedValue(fieldId as string)).resolves.toEqual(expected);
    });
  });

  describe('R03 lookup de-duplication', () => {
    it('returns a single value for a single-value lookup with no links', async () => {
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'R03 Lookup Foreign',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'singleSelect',
            name: 'Status',
            options: { choices: [{ name: 'A' }, { name: 'B' }] },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const statusId = fieldByName(foreign, 'Status').id;
      await ctx.createRecords(foreign.id, [
        { fields: { [statusId]: 'A' } },
        { fields: { [statusId]: 'A' } },
        { fields: { [statusId]: 'B' } },
      ]);

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'R03 Lookup Host',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Link',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: fieldByName(foreign, 'Title').id,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const hostTitleId = fieldByName(host, 'Title').id;
      const linkId = fieldByName(host, 'Link').id;

      const plain = await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'lookup',
          name: 'LookupPlain',
          options: { linkFieldId: linkId, foreignTableId: foreign.id, lookupFieldId: statusId },
        },
      });
      const unique = await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'lookup',
          name: 'LookupUnique',
          options: {
            linkFieldId: linkId,
            foreignTableId: foreign.id,
            lookupFieldId: statusId,
            isUnique: true,
          },
        },
      });
      const plainId = fieldByName(plain, 'LookupPlain').id;
      const uniqueId = fieldByName(unique, 'LookupUnique').id;

      const foreignRows = await ctx.listRecords(foreign.id, { limit: 100, sort: undefined });
      const linked = await ctx.createRecord(host.id, {
        [hostTitleId]: 'linked',
        [linkId]: foreignRows.map((row) => ({ id: row.id })),
      });
      await ctx.drainOutbox();

      const rows = await ctx.listRecords(host.id, { limit: 1000 });
      const row = findRow(rows, linked.id);
      const plainValue = row?.fields[plainId] as unknown[];
      const uniqueValue = row?.fields[uniqueId] as unknown[];

      // R03: de-duplication keeps the first-seen order of the distinct values.
      expect(plainValue).toEqual(['A', 'A', 'B']);
      expect(uniqueValue).toEqual(['A', 'B']);
    });

    it('returns an empty result for a renamed host with no links', async () => {
      const row = findRow(await ctx.listRecords(tableId, { limit: 1000 }), createdRecordId);
      expect(row?.fields[titleId]).toBe('no links');
    });
  });
});
