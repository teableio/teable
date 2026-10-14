/**
 * A01–A07 — which statistic each field type is allowed to offer.
 *
 * A01 (实现依据): the statistic menu follows the field's *value type* and its
 * multiplicity, not its name. A formula field returning numbers offers the
 * numeric set; a lookup of a date offers the date set.
 * A02–A07 (实现依据): the per-type sets below are the capability table from
 * the requirement document, asserted exhaustively.
 *
 * The table is the specification: every ordered pair of (field, statistic) is
 * either accepted or rejected with a "not supported" error. Asserting the
 * negative direction matters as much as the positive one — it is what stops a
 * string field from silently offering `sum`.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { ActorId, AggregateTableRecordsQuery, v2CoreTokens, type IQueryBus } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

const COMMON = [
  'count',
  'empty',
  'filled',
  'unique',
  'percentEmpty',
  'percentFilled',
  'percentUnique',
] as const;

/** A03/A08 numeric fields add the arithmetic set. */
const NUMERIC = [...COMMON, 'sum', 'average', 'min', 'max'] as const;

/** A04 date fields add the boundary and range set. */
const DATETIME = [
  ...COMMON,
  'earliestDate',
  'latestDate',
  'dateRangeOfDays',
  'dateRangeOfMonths',
] as const;

/** A05 checkbox replaces empty/filled/unique with the checked pair. */
const BOOLEAN = ['count', 'checked', 'unChecked', 'percentChecked', 'percentUnChecked'] as const;

/** A07 link and multi-user fields only report occupancy. */
const OCCUPANCY = ['count', 'empty', 'filled', 'percentEmpty', 'percentFilled'] as const;

/** A06 attachments drop unique and add total size. */
const ATTACHMENT = [
  ...COMMON.filter((fn) => fn !== 'unique' && fn !== 'percentUnique'),
  'totalAttachmentSize',
] as const;

const ALL_FUNCTIONS = [
  ...new Set([...NUMERIC, ...DATETIME, ...BOOLEAN, ...OCCUPANCY, ...ATTACHMENT]),
] as const;

type FieldCase = {
  /** Field name on the fixture table. */
  readonly field: string;
  /** Requirement-facing description used in the test title. */
  readonly rule: string;
  readonly allowed: ReadonlyArray<string>;
};

const fieldCases: ReadonlyArray<FieldCase> = [
  // A02 — text keeps the common set and nothing more.
  { field: 'Text', rule: 'A02 single line text', allowed: COMMON },
  { field: 'LongText', rule: 'A02 long text', allowed: COMMON },
  { field: 'Select', rule: 'A02 single select', allowed: COMMON },
  { field: 'MultiSelect', rule: 'A02 multiple select', allowed: COMMON },
  { field: 'Formula', rule: 'A01 formula resolving to text', allowed: COMMON },

  // A03 — numeric value types add sum/average/min/max.
  { field: 'Number', rule: 'A03 number', allowed: NUMERIC },
  { field: 'Rating', rule: 'A03 rating', allowed: NUMERIC },
  { field: 'AutoNumber', rule: 'A03 auto number', allowed: NUMERIC },
  { field: 'NumberFormula', rule: 'A01 formula resolving to number', allowed: NUMERIC },
  { field: 'NumberLookup', rule: 'A01 lookup resolving to number', allowed: NUMERIC },
  { field: 'NumberRollup', rule: 'A01 rollup resolving to number', allowed: NUMERIC },

  // A04 — date value types add the date set.
  { field: 'Date', rule: 'A04 date', allowed: DATETIME },
  { field: 'CreatedTime', rule: 'A04 created time', allowed: DATETIME },
  { field: 'LastModifiedTime', rule: 'A04 last modified time', allowed: DATETIME },

  // A05 — checkbox is a dedicated set, not the common one.
  { field: 'Checkbox', rule: 'A05 checkbox', allowed: BOOLEAN },

  // A07 — single user fields keep unique, multiple-capable ones do not.
  { field: 'CreatedBy', rule: 'A07 single user (created by)', allowed: COMMON },
  { field: 'LastModifiedBy', rule: 'A07 single user (last modified by)', allowed: COMMON },
  { field: 'SingleUser', rule: 'A07 single user', allowed: COMMON },
  { field: 'MultiUser', rule: 'A07 multiple users', allowed: OCCUPANCY },
  { field: 'Link', rule: 'A07 link', allowed: OCCUPANCY },

  // A06 — attachment drops unique and adds total size.
  { field: 'Attachment', rule: 'A06 attachment', allowed: ATTACHMENT },
];

describe('A01–A07: statistic availability per field type', () => {
  let ctx: SharedTestContext;
  let queryBus: IQueryBus;
  let tableId: string;
  const ids: Record<string, string> = {};
  const actorId = ActorId.create('usrTestUserId')._unsafeUnwrap();

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    queryBus = ctx.testContainer.container.resolve(v2CoreTokens.queryBus);

    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'A01 Statistic Foreign',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Score', options: { defaultValue: 1 } },
      ],
      views: [{ type: 'grid' }],
    });
    const foreignScoreId = fieldByName(foreign, 'Score').id;
    await ctx.createRecords(foreign.id, [
      { fields: { [fieldByName(foreign, 'Title').id]: 'f-1', [foreignScoreId]: 1 } },
      { fields: { [fieldByName(foreign, 'Title').id]: 'f-2', [foreignScoreId]: 2 } },
    ]);

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'A01 Statistic Matrix',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text' },
        { type: 'longText', name: 'LongText' },
        {
          type: 'singleSelect',
          name: 'Select',
          options: { choices: [{ name: 'A' }, { name: 'B' }] },
        },
        {
          type: 'multipleSelect',
          name: 'MultiSelect',
          options: { choices: [{ name: 'A' }, { name: 'B' }] },
        },
        { type: 'formula', name: 'Formula', options: { expression: 'CONCATENATE("x", "y")' } },
        {
          type: 'formula',
          name: 'NumberFormula',
          options: { expression: 'SUM(1, 2)' },
        },
        { type: 'number', name: 'Number' },
        { type: 'rating', name: 'Rating', options: { max: 5 } },
        { type: 'autoNumber', name: 'AutoNumber' },
        { type: 'date', name: 'Date' },
        { type: 'createdTime', name: 'CreatedTime' },
        { type: 'lastModifiedTime', name: 'LastModifiedTime' },
        { type: 'checkbox', name: 'Checkbox' },
        { type: 'createdBy', name: 'CreatedBy' },
        { type: 'lastModifiedBy', name: 'LastModifiedBy' },
        { type: 'user', name: 'SingleUser', options: { isMultiple: false } },
        { type: 'user', name: 'MultiUser', options: { isMultiple: true } },
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
        { type: 'attachment', name: 'Attachment' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;

    // Lookup/rollup need the link field id, so they are added afterwards.
    const linkId = fieldByName(table, 'Link').id;
    const withLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'lookup',
        name: 'NumberLookup',
        options: {
          linkFieldId: linkId,
          foreignTableId: foreign.id,
          lookupFieldId: foreignScoreId,
        },
      },
    });
    expect(withLookup).toBeTruthy();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'rollup',
        name: 'NumberRollup',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId: linkId,
          foreignTableId: foreign.id,
          lookupFieldId: foreignScoreId,
        },
      },
    });

    await ctx.createRecord(tableId, {});
    await ctx.drainOutbox();

    const fresh = await ctx.getTableById(tableId);
    for (const field of fresh.fields) ids[field.name] = field.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const runStatistic = async (fieldId: string, statisticFunc: string) => {
    const query = AggregateTableRecordsQuery.create({
      tableId,
      fields: [{ fieldId, statisticFunc }],
    });
    if (query.isErr()) return { ok: false as const, message: query.error.message };
    const result = await queryBus.execute({ actorId, windowId: 'e2e-window' }, query.value);
    if (result.isErr()) return { ok: false as const, message: result.error.message };
    return { ok: true as const, message: '' };
  };

  describe.each(fieldCases)('$rule', ({ field, allowed }) => {
    const allowedSet = new Set<string>(allowed);
    const rejected = ALL_FUNCTIONS.filter((fn) => !allowedSet.has(fn));

    it.each([...allowedSet])('accepts %s', async (statisticFunc) => {
      const outcome = await runStatistic(ids[field], statisticFunc);
      expect(outcome, `${field} should accept ${statisticFunc}: ${outcome.message}`).toMatchObject({
        ok: true,
      });
    });

    it.each(rejected)('rejects %s', async (statisticFunc) => {
      const outcome = await runStatistic(ids[field], statisticFunc);
      expect(outcome.ok, `${field} must not accept ${statisticFunc}`).toBe(false);
      expect(outcome.message).toMatch(/not supported/i);
    });
  });

  it('A01 rejects an unknown statistic function', async () => {
    const outcome = await runStatistic(ids.Number, 'notAStatistic');
    expect(outcome.ok).toBe(false);
  });

  it('A01 rejects an unknown field id', async () => {
    const outcome = await runStatistic('fldDoesNotExist0000000', 'count');
    expect(outcome.ok).toBe(false);
  });
});
