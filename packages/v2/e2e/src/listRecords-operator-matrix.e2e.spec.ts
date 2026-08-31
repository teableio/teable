/* eslint-disable @typescript-eslint/naming-convention */
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * v1-parity operator × field-type matrix for listRecords filters.
 *
 * v1 references:
 * - apps/nestjs-backend/test/comprehensive-field-filter.e2e-spec.ts
 * - apps/nestjs-backend/test/record-filter-query-issues.e2e-spec.ts (T1781, T3109)
 * - apps/nestjs-backend/test/data-helpers/caces/record-filter-query/*
 *
 * Semantics under test (T6520): cells cleared with ""/false/[] are stored as
 * null, negative operators (isNot/doesNotContain/isNoneOf/hasNoneOf/
 * isNotExactly) include null rows, and isEmpty matches cleared cells.
 *
 * DateRange edge cases are covered in record-filter-is-with-in.e2e.spec.ts.
 * This file also ports the deterministic v1 date and date-lookup mode matrices
 * with a frozen clock and an isolated fixture.
 */
describe('v2 listRecords filter operator matrix (e2e)', () => {
  let ctx: SharedTestContext;

  const drainOutbox = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listWithFilter = async (tableId: string, filter: unknown) => {
    await drainOutbox();

    const params = new URLSearchParams({
      tableId,
      fieldKeyType: FieldKeyType.Id,
      filter: JSON.stringify(filter),
    });

    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }

    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`ListRecords response invalid: ${JSON.stringify(rawBody)}`);
    }

    return parsed.data.data.records;
  };

  const expectFilterCount = async (tableId: string, filter: unknown, expected: number) => {
    const records = await listWithFilter(tableId, filter);
    expect(records).toHaveLength(expected);
    return records;
  };

  const expectFilterNames = async (
    tableId: string,
    filter: unknown,
    nameFieldId: string,
    expectedNames: string[]
  ) => {
    const records = await listWithFilter(tableId, filter);
    expect(records.map((record) => String(record.fields[nameFieldId])).sort()).toEqual(
      [...expectedNames].sort()
    );
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 60000);

  // ------------------------------------------------------------------
  // Text (singleLineText + longText)
  // v1: Text Field Filters / Long Text Field Filters / TEXT_FIELD_CASES
  // ------------------------------------------------------------------
  describe('text field operators', () => {
    let tableId: string;
    let textFieldId: string;
    let longTextFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Text',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Text', type: 'singleLineText' },
          { name: 'Long', type: 'longText' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';
      longTextFieldId = table.fields.find((f) => f.name === 'Long')?.id ?? '';

      await ctx.createRecords(tableId, [
        {
          fields: {
            [textFieldId]: 'Test Text 1',
            [longTextFieldId]: 'This is a long text content for testing',
          },
        },
        {
          fields: {
            [textFieldId]: 'Test Text 2',
            [longTextFieldId]: 'Another long text for testing purposes',
          },
        },
        { fields: {} },
      ]);
    }, 60000);

    it('is matches an exact value', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: textFieldId, operator: 'is', value: 'Test Text 1' },
        1
      );
    });

    it('is is case-sensitive (v1 TEXT_FIELD_CASES lower-case probe)', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: textFieldId, operator: 'is', value: 'test text 1' },
        0
      );
    });

    it('isNot excludes the value and keeps null rows', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: textFieldId, operator: 'isNot', value: 'Test Text 1' },
        2
      );
    });

    it('contains matches substrings', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: textFieldId, operator: 'contains', value: 'Test' },
        2
      );
    });

    it('contains is case-insensitive', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: textFieldId, operator: 'contains', value: 'test' },
        2
      );
    });

    it('doesNotContain keeps null rows', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: textFieldId, operator: 'doesNotContain', value: 'Test' },
        1
      );
    });

    it('isEmpty / isNotEmpty split null and non-null rows', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: textFieldId, operator: 'isEmpty', value: null },
        1
      );
      await expectFilterCount(
        tableId,
        { fieldId: textFieldId, operator: 'isNotEmpty', value: null },
        2
      );
    });

    it('long text supports contains / doesNotContain / isEmpty / isNotEmpty', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: longTextFieldId, operator: 'contains', value: 'long text' },
        2
      );
      await expectFilterCount(
        tableId,
        { fieldId: longTextFieldId, operator: 'doesNotContain', value: 'testing' },
        1
      );
      await expectFilterCount(
        tableId,
        { fieldId: longTextFieldId, operator: 'isEmpty', value: null },
        1
      );
      await expectFilterCount(
        tableId,
        { fieldId: longTextFieldId, operator: 'isNotEmpty', value: null },
        2
      );
    });
  });

  // ------------------------------------------------------------------
  // T1781: SQL LIKE wildcards must be escaped in contains filters
  // ------------------------------------------------------------------
  describe('T1781 SQL LIKE wildcard escape', () => {
    let tableId: string;
    let textFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Like Wildcards',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Text', type: 'singleLineText' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';

      const values = [
        'Contains % percent sign',
        'Contains _ underscore',
        'Contains \\ backslash',
        'Normal text',
        '100%',
        '50%',
        'file_name.txt',
        'path\\to\\file',
        '%_%',
        null,
      ];
      await ctx.createRecords(
        tableId,
        values.map((value) => ({ fields: value === null ? {} : { [textFieldId]: value } }))
      );
    }, 60000);

    it.each([
      { op: 'contains', value: '%', expected: 4 },
      { op: 'contains', value: '_', expected: 3 },
      { op: 'contains', value: '\\', expected: 2 },
      { op: 'contains', value: '%_%', expected: 1 },
      { op: 'contains', value: '0%', expected: 2 },
      { op: 'doesNotContain', value: '%', expected: 6 },
      { op: 'doesNotContain', value: '_', expected: 7 },
    ])('$op "$value" -> $expected records', async ({ op, value, expected }) => {
      await expectFilterCount(tableId, { fieldId: textFieldId, operator: op, value }, expected);
    });
  });

  // ------------------------------------------------------------------
  // Number
  // v1: Number Field Filters / NUMBER_FIELD_CASES
  // ------------------------------------------------------------------
  describe('number field operators', () => {
    let tableId: string;
    let nameFieldId: string;
    let numberFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Number',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Number', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Number')?.id ?? '';

      await ctx.createRecords(tableId, [
        { fields: { [nameFieldId]: 'Low', [numberFieldId]: 10.5 } },
        { fields: { [nameFieldId]: 'High', [numberFieldId]: 25.75 } },
        { fields: { [nameFieldId]: 'Empty' } },
      ]);
    }, 60000);

    it.each([
      { op: 'is', value: 10.5, expected: 1 },
      { op: 'isNot', value: 10.5, expected: 2 },
      { op: 'isGreater', value: 20, expected: 1 },
      { op: 'isGreaterEqual', value: 10.5, expected: 2 },
      { op: 'isLess', value: 20, expected: 1 },
      { op: 'isLessEqual', value: 25.75, expected: 2 },
      { op: 'isEmpty', value: null, expected: 1 },
      { op: 'isNotEmpty', value: null, expected: 2 },
    ])('$op $value -> $expected records', async ({ op, value, expected }) => {
      await expectFilterCount(tableId, { fieldId: numberFieldId, operator: op, value }, expected);
    });

    it('distinguishes greater-than from less-than results', async () => {
      await expectFilterNames(
        tableId,
        { fieldId: numberFieldId, operator: 'isGreater', value: 20 },
        nameFieldId,
        ['High']
      );
      await expectFilterNames(
        tableId,
        { fieldId: numberFieldId, operator: 'isLess', value: 20 },
        nameFieldId,
        ['Low']
      );
    });
  });

  // ------------------------------------------------------------------
  // Rating (number cell value type)
  // v1: Rating Field Filters
  // ------------------------------------------------------------------
  describe('rating field operators', () => {
    let tableId: string;
    let nameFieldId: string;
    let ratingFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Rating',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Rating',
            type: 'rating',
            options: { max: 5, icon: 'star', color: 'yellowBright' },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      ratingFieldId = table.fields.find((f) => f.name === 'Rating')?.id ?? '';

      await ctx.createRecords(tableId, [
        { fields: { [nameFieldId]: 'Four', [ratingFieldId]: 4 } },
        { fields: { [nameFieldId]: 'Three', [ratingFieldId]: 3 } },
        { fields: { [nameFieldId]: 'Empty' } },
      ]);
    }, 60000);

    it.each([
      { op: 'is', value: 4, expected: 1 },
      { op: 'isNot', value: 4, expected: 2 },
      { op: 'isGreater', value: 3, expected: 1 },
      { op: 'isGreaterEqual', value: 3, expected: 2 },
      { op: 'isLess', value: 4, expected: 1 },
      { op: 'isLessEqual', value: 4, expected: 2 },
      { op: 'isEmpty', value: null, expected: 1 },
      { op: 'isNotEmpty', value: null, expected: 2 },
    ])('$op $value -> $expected records', async ({ op, value, expected }) => {
      await expectFilterCount(tableId, { fieldId: ratingFieldId, operator: op, value }, expected);
    });

    it('distinguishes greater-than from less-than results', async () => {
      await expectFilterNames(
        tableId,
        { fieldId: ratingFieldId, operator: 'isGreater', value: 3 },
        nameFieldId,
        ['Four']
      );
      await expectFilterNames(
        tableId,
        { fieldId: ratingFieldId, operator: 'isLess', value: 4 },
        nameFieldId,
        ['Three']
      );
    });
  });

  // ------------------------------------------------------------------
  // Date — exactDate mode
  // v1: Date Field Filters (comprehensive-field-filter)
  // ------------------------------------------------------------------
  describe('date field operators with exactDate mode', () => {
    let tableId: string;
    let nameFieldId: string;
    let dateFieldId: string;

    const exact = (isoDate: string) => ({
      mode: 'exactDate',
      exactDate: isoDate,
      timeZone: 'UTC',
    });

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Date Exact',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Date', type: 'date' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';

      await ctx.createRecords(tableId, [
        {
          fields: { [nameFieldId]: 'Jan', [dateFieldId]: '2024-01-15T00:00:00.000Z' },
        },
        {
          fields: { [nameFieldId]: 'Feb', [dateFieldId]: '2024-02-20T00:00:00.000Z' },
        },
        { fields: { [nameFieldId]: 'Empty' } },
      ]);
    }, 60000);

    it.each([
      { op: 'is', date: '2024-01-15T00:00:00.000Z', expected: 1 },
      { op: 'isNot', date: '2024-01-15T00:00:00.000Z', expected: 2 },
      { op: 'isAfter', date: '2024-01-31T00:00:00.000Z', expected: 1 },
      { op: 'isBefore', date: '2024-02-01T00:00:00.000Z', expected: 1 },
      { op: 'isOnOrAfter', date: '2024-01-15T00:00:00.000Z', expected: 2 },
      { op: 'isOnOrBefore', date: '2024-02-20T00:00:00.000Z', expected: 2 },
    ])('$op exactDate $date -> $expected records', async ({ op, date, expected }) => {
      await expectFilterCount(
        tableId,
        { fieldId: dateFieldId, operator: op, value: exact(date) },
        expected
      );
    });

    it('isEmpty / isNotEmpty split null and dated rows', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: dateFieldId, operator: 'isEmpty', value: null },
        1
      );
      await expectFilterCount(
        tableId,
        { fieldId: dateFieldId, operator: 'isNotEmpty', value: null },
        2
      );
    });

    it('distinguishes dates before and after the boundary', async () => {
      await expectFilterNames(
        tableId,
        { fieldId: dateFieldId, operator: 'isAfter', value: exact('2024-01-31T00:00:00.000Z') },
        nameFieldId,
        ['Feb']
      );
      await expectFilterNames(
        tableId,
        { fieldId: dateFieldId, operator: 'isBefore', value: exact('2024-02-01T00:00:00.000Z') },
        nameFieldId,
        ['Jan']
      );
    });
  });

  // ------------------------------------------------------------------
  // Date — deterministic v1 date and date-lookup mode matrices
  // v1: DATE_FIELD_CASES / DATE_LOOKUP_FIELD_CASES
  // ------------------------------------------------------------------
  describe('date field and lookup operators with relative modes', () => {
    type DateMatrixOperator =
      | 'is'
      | 'isNot'
      | 'isBefore'
      | 'isAfter'
      | 'isOnOrBefore'
      | 'isOnOrAfter'
      | 'isWithIn';

    type DateRow = {
      name: string;
      days: string[];
    };

    type DateModeCase = {
      mode: string;
      startDay: string;
      endDay: string;
      field: 'date' | 'month';
      numberOfDays?: number;
      exactDate?: string;
    };

    const timeZone = 'Asia/Singapore';
    const localNoonIso = (day: string) => `${day}T04:00:00.000Z`;
    const directRows: DateRow[] = [
      { name: 'LastYearStart', days: ['2025-01-15'] },
      { name: 'LastYearSameDay', days: ['2025-06-15'] },
      { name: 'CurrentYearStart', days: ['2026-01-15'] },
      { name: 'LastMonthStart', days: ['2026-05-01'] },
      { name: 'OneMonthAgo', days: ['2026-05-15'] },
      { name: 'LastWeekStart', days: ['2026-06-08'] },
      { name: 'Yesterday', days: ['2026-06-14'] },
      { name: 'Today', days: ['2026-06-15'] },
      { name: 'Tomorrow', days: ['2026-06-16'] },
      { name: 'CurrentWeekEnd', days: ['2026-06-21'] },
      { name: 'OneWeekFromNow', days: ['2026-06-22'] },
      { name: 'NextWeekEnd', days: ['2026-06-28'] },
      { name: 'CurrentMonthEnd', days: ['2026-06-30'] },
      { name: 'NextMonthStart', days: ['2026-07-01'] },
      { name: 'OneMonthFromNow', days: ['2026-07-15'] },
      { name: 'NextMonthEnd', days: ['2026-07-31'] },
      { name: 'CurrentYearEnd', days: ['2026-12-31'] },
      { name: 'NextYearStart', days: ['2027-01-01'] },
      { name: 'NextYearSameDay', days: ['2027-06-15'] },
      { name: 'NextYearEnd', days: ['2027-12-31'] },
      { name: 'FutureYear', days: ['2028-01-01'] },
      { name: 'NoDate', days: [] },
    ];
    const lookupRows: DateRow[] = [
      ...directRows,
      {
        name: 'MixedPeriods',
        days: ['2025-06-15', '2026-06-15', '2027-06-15'],
      },
    ];

    const dateModeCases: DateModeCase[] = [
      { mode: 'today', startDay: '2026-06-15', endDay: '2026-06-15', field: 'date' },
      { mode: 'tomorrow', startDay: '2026-06-16', endDay: '2026-06-16', field: 'date' },
      { mode: 'yesterday', startDay: '2026-06-14', endDay: '2026-06-14', field: 'date' },
      { mode: 'currentWeek', startDay: '2026-06-15', endDay: '2026-06-21', field: 'date' },
      { mode: 'lastWeek', startDay: '2026-06-08', endDay: '2026-06-14', field: 'date' },
      { mode: 'nextWeekPeriod', startDay: '2026-06-22', endDay: '2026-06-28', field: 'date' },
      { mode: 'currentMonth', startDay: '2026-06-01', endDay: '2026-06-30', field: 'date' },
      { mode: 'lastMonth', startDay: '2026-05-01', endDay: '2026-05-31', field: 'date' },
      { mode: 'nextMonthPeriod', startDay: '2026-07-01', endDay: '2026-07-31', field: 'date' },
      { mode: 'currentYear', startDay: '2026-01-01', endDay: '2026-12-31', field: 'date' },
      { mode: 'lastYear', startDay: '2025-01-01', endDay: '2025-12-31', field: 'date' },
      { mode: 'nextYearPeriod', startDay: '2027-01-01', endDay: '2027-12-31', field: 'date' },
      { mode: 'oneWeekAgo', startDay: '2026-06-08', endDay: '2026-06-08', field: 'date' },
      { mode: 'oneWeekFromNow', startDay: '2026-06-22', endDay: '2026-06-22', field: 'date' },
      { mode: 'oneMonthAgo', startDay: '2026-05-15', endDay: '2026-05-15', field: 'date' },
      { mode: 'oneMonthFromNow', startDay: '2026-07-15', endDay: '2026-07-15', field: 'date' },
      {
        mode: 'daysAgo',
        numberOfDays: 1,
        startDay: '2026-06-14',
        endDay: '2026-06-14',
        field: 'date',
      },
      {
        mode: 'daysFromNow',
        numberOfDays: 1,
        startDay: '2026-06-16',
        endDay: '2026-06-16',
        field: 'date',
      },
      {
        mode: 'exactDate',
        exactDate: localNoonIso('2026-06-08'),
        startDay: '2026-06-08',
        endDay: '2026-06-08',
        field: 'date',
      },
      {
        mode: 'exactFormatDate',
        exactDate: localNoonIso('2026-05-15'),
        startDay: '2026-05-01',
        endDay: '2026-05-31',
        field: 'month',
      },
    ];

    const withinModeCases: DateModeCase[] = [
      { mode: 'pastWeek', startDay: '2026-06-08', endDay: '2026-06-15', field: 'date' },
      { mode: 'pastMonth', startDay: '2026-05-15', endDay: '2026-06-15', field: 'date' },
      { mode: 'pastYear', startDay: '2025-06-15', endDay: '2026-06-15', field: 'date' },
      { mode: 'nextWeek', startDay: '2026-06-15', endDay: '2026-06-22', field: 'date' },
      { mode: 'nextMonth', startDay: '2026-06-15', endDay: '2026-07-15', field: 'date' },
      { mode: 'nextYear', startDay: '2026-06-15', endDay: '2027-06-15', field: 'date' },
      {
        mode: 'pastNumberOfDays',
        numberOfDays: 1,
        startDay: '2026-06-14',
        endDay: '2026-06-15',
        field: 'date',
      },
      {
        mode: 'nextNumberOfDays',
        numberOfDays: 1,
        startDay: '2026-06-15',
        endDay: '2026-06-16',
        field: 'date',
      },
    ];

    const comparisonOperators: DateMatrixOperator[] = [
      'is',
      'isNot',
      'isBefore',
      'isAfter',
      'isOnOrBefore',
      'isOnOrAfter',
    ];

    let sourceTableId: string;
    let sourceNameFieldId: string;
    let dateFieldId: string;
    let monthFieldId: string;
    let lookupTableId: string;
    let lookupNameFieldId: string;
    let lookupDateFieldId: string;
    let lookupMonthFieldId: string;

    const valueFor = ({ mode, numberOfDays, exactDate }: DateModeCase) => ({
      mode,
      ...(numberOfDays === undefined ? {} : { numberOfDays }),
      ...(exactDate === undefined ? {} : { exactDate }),
      timeZone,
    });

    const matches = (
      days: string[],
      operator: DateMatrixOperator,
      { startDay, endDay }: DateModeCase
    ) => {
      const isWithin = days.some((day) => day >= startDay && day <= endDay);
      if (operator === 'is' || operator === 'isWithIn') return isWithin;
      if (operator === 'isNot') return !isWithin;
      if (operator === 'isBefore') return days.some((day) => day < startDay);
      if (operator === 'isAfter') return days.some((day) => day > endDay);
      if (operator === 'isOnOrBefore') return days.some((day) => day <= endDay);
      return days.some((day) => day >= startDay);
    };

    const expectedNames = (rows: DateRow[], operator: DateMatrixOperator, modeCase: DateModeCase) =>
      rows.filter((row) => matches(row.days, operator, modeCase)).map((row) => row.name);

    beforeAll(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-15T04:00:00.000Z'));
    });

    afterAll(() => {
      vi.useRealTimers();
    });

    beforeAll(async () => {
      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Date Relative',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Date',
            type: 'date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone },
            },
          },
          {
            name: 'Month',
            type: 'date',
            options: {
              formatting: { date: 'YYYY-MM', time: 'None', timeZone },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      sourceTableId = sourceTable.id;
      sourceNameFieldId = sourceTable.fields.find((f) => f.isPrimary)?.id ?? '';
      dateFieldId = sourceTable.fields.find((f) => f.name === 'Date')?.id ?? '';
      monthFieldId = sourceTable.fields.find((f) => f.name === 'Month')?.id ?? '';

      const sourceRecords = await ctx.createRecords(
        sourceTableId,
        directRows.map((row) => ({
          fields: {
            [sourceNameFieldId]: row.name,
            ...(row.days[0]
              ? {
                  [dateFieldId]: localNoonIso(row.days[0]),
                  [monthFieldId]: localNoonIso(row.days[0]),
                }
              : {}),
          },
        }))
      );
      const sourceRecordIdsByDay = new Map<string, string>();
      directRows.forEach((row, index) => {
        const day = row.days[0];
        const sourceRecord = sourceRecords[index];
        if (day && sourceRecord) sourceRecordIdsByDay.set(day, sourceRecord.id);
      });

      const lookupTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Date Lookup Relative',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Link',
            type: 'link',
            options: {
              relationship: 'manyMany',
              foreignTableId: sourceTableId,
              lookupFieldId: sourceNameFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      lookupTableId = lookupTable.id;
      lookupNameFieldId = lookupTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const linkFieldId = lookupTable.fields.find((f) => f.name === 'Link')?.id ?? '';

      const withDateLookups = await ctx.createField({
        baseId: ctx.baseId,
        tableId: lookupTableId,
        field: {
          type: 'lookup',
          name: 'Lookup Date',
          options: {
            foreignTableId: sourceTableId,
            lookupFieldId: dateFieldId,
            linkFieldId,
          },
        },
      });
      lookupDateFieldId = withDateLookups.fields.find((f) => f.name === 'Lookup Date')?.id ?? '';

      const withMonthLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: lookupTableId,
        field: {
          type: 'lookup',
          name: 'Lookup Month',
          options: {
            foreignTableId: sourceTableId,
            lookupFieldId: monthFieldId,
            linkFieldId,
          },
        },
      });
      lookupMonthFieldId = withMonthLookup.fields.find((f) => f.name === 'Lookup Month')?.id ?? '';

      await ctx.createRecords(
        lookupTableId,
        lookupRows.map((row) => ({
          fields: {
            [lookupNameFieldId]: row.name,
            [linkFieldId]: row.days.map((day) => {
              const sourceRecordId = sourceRecordIdsByDay.get(day);
              if (!sourceRecordId) throw new Error(`Missing source record for ${day}`);
              return { id: sourceRecordId };
            }),
          },
        }))
      );
    }, 120000);

    const comparisonCases = dateModeCases.flatMap((modeCase) =>
      comparisonOperators.map((operator) => ({ operator, mode: modeCase.mode, modeCase }))
    );

    it.each(comparisonCases)('direct date: $operator $mode', async ({ operator, modeCase }) => {
      const fieldId = modeCase.field === 'month' ? monthFieldId : dateFieldId;
      await expectFilterNames(
        sourceTableId,
        { fieldId, operator, value: valueFor(modeCase) },
        sourceNameFieldId,
        expectedNames(directRows, operator, modeCase)
      );
    });

    it.each(withinModeCases)('direct date: isWithIn $mode', async (modeCase) => {
      await expectFilterNames(
        sourceTableId,
        { fieldId: dateFieldId, operator: 'isWithIn', value: valueFor(modeCase) },
        sourceNameFieldId,
        expectedNames(directRows, 'isWithIn', modeCase)
      );
    });

    it.each(comparisonCases)('lookup date: $operator $mode', async ({ operator, modeCase }) => {
      const fieldId = modeCase.field === 'month' ? lookupMonthFieldId : lookupDateFieldId;
      await expectFilterNames(
        lookupTableId,
        { fieldId, operator, value: valueFor(modeCase) },
        lookupNameFieldId,
        expectedNames(lookupRows, operator, modeCase)
      );
    });

    it.each(withinModeCases)('lookup date: isWithIn $mode', async (modeCase) => {
      await expectFilterNames(
        lookupTableId,
        { fieldId: lookupDateFieldId, operator: 'isWithIn', value: valueFor(modeCase) },
        lookupNameFieldId,
        expectedNames(lookupRows, 'isWithIn', modeCase)
      );
    });

    it.each([
      {
        label: 'direct',
        tableId: () => sourceTableId,
        fieldId: () => dateFieldId,
        rows: directRows,
      },
      {
        label: 'lookup',
        tableId: () => lookupTableId,
        fieldId: () => lookupDateFieldId,
        rows: lookupRows,
      },
    ])('$label date supports isEmpty and isNotEmpty', async ({ tableId, fieldId, rows }) => {
      await expectFilterCount(
        tableId(),
        { fieldId: fieldId(), operator: 'isEmpty', value: null },
        rows.filter((row) => row.days.length === 0).length
      );
      await expectFilterCount(
        tableId(),
        { fieldId: fieldId(), operator: 'isNotEmpty', value: null },
        rows.filter((row) => row.days.length > 0).length
      );
    });

    it('lookup date supports dateRange with any-value matching', async () => {
      const modeCase: DateModeCase = {
        mode: 'dateRange',
        exactDate: localNoonIso('2026-06-14'),
        startDay: '2026-06-14',
        endDay: '2026-06-16',
        field: 'date',
      };
      await expectFilterNames(
        lookupTableId,
        {
          fieldId: lookupDateFieldId,
          operator: 'is',
          value: {
            ...valueFor(modeCase),
            exactDateEnd: localNoonIso('2026-06-16'),
          },
        },
        lookupNameFieldId,
        expectedNames(lookupRows, 'is', modeCase)
      );
    });
  });

  // ------------------------------------------------------------------
  // Checkbox — only 'is' is valid; false/null both mean unchecked (T6520)
  // v1: Checkbox Field Filters / CHECKBOX_FIELD_CASES / T1613
  // ------------------------------------------------------------------
  describe('checkbox field operators', () => {
    let tableId: string;
    let checkboxFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Checkbox',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Check', type: 'checkbox' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      checkboxFieldId = table.fields.find((f) => f.name === 'Check')?.id ?? '';

      await ctx.createRecords(tableId, [
        { fields: { [checkboxFieldId]: true } },
        // false is normalized to null on write (T6520); still counts as unchecked
        { fields: { [checkboxFieldId]: false } },
        { fields: {} },
      ]);
    }, 60000);

    it.each([
      { value: true, expected: 1 },
      { value: false, expected: 2 },
      { value: null, expected: 2 },
    ])('is $value -> $expected records', async ({ value, expected }) => {
      await expectFilterCount(
        tableId,
        { fieldId: checkboxFieldId, operator: 'is', value },
        expected
      );
    });
  });

  // ------------------------------------------------------------------
  // Single select
  // v1: Single Select Field Filters / SINGLE_SELECT_FIELD_CASES
  // ------------------------------------------------------------------
  describe('single select field operators', () => {
    let tableId: string;
    let selectFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Single Select',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Select', type: 'singleSelect', options: ['Option 1', 'Option 2', 'Option 3'] },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      selectFieldId = table.fields.find((f) => f.name === 'Select')?.id ?? '';

      await ctx.createRecords(tableId, [
        { fields: { [selectFieldId]: 'Option 1' } },
        { fields: { [selectFieldId]: 'Option 2' } },
        { fields: {} },
      ]);
    }, 60000);

    it.each([
      { op: 'is', value: 'Option 1', expected: 1 },
      { op: 'isNot', value: 'Option 1', expected: 2 },
      { op: 'isAnyOf', value: ['Option 1', 'Option 2'], expected: 2 },
      { op: 'isNoneOf', value: ['Option 1'], expected: 2 },
      { op: 'isEmpty', value: null, expected: 1 },
      { op: 'isNotEmpty', value: null, expected: 2 },
    ])('$op -> $expected records', async ({ op, value, expected }) => {
      await expectFilterCount(tableId, { fieldId: selectFieldId, operator: op, value }, expected);
    });
  });

  // ------------------------------------------------------------------
  // Multiple select
  // v1: Multiple Select Field Filters / MULTIPLE_SELECT_FIELD_CASES
  // ------------------------------------------------------------------
  describe('multiple select field operators', () => {
    let tableId: string;
    let tagsFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Multiple Select',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Tags', type: 'multipleSelect', options: ['Tag 1', 'Tag 2', 'Tag 3'] },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      tagsFieldId = table.fields.find((f) => f.name === 'Tags')?.id ?? '';

      await ctx.createRecords(tableId, [
        { fields: { [tagsFieldId]: ['Tag 1', 'Tag 2'] } },
        { fields: { [tagsFieldId]: ['Tag 2', 'Tag 3'] } },
        { fields: {} },
      ]);
    }, 60000);

    it.each([
      { op: 'hasAnyOf', value: ['Tag 1'], expected: 1 },
      { op: 'hasAllOf', value: ['Tag 1', 'Tag 2'], expected: 1 },
      { op: 'hasNoneOf', value: ['Tag 1'], expected: 2 },
      { op: 'isExactly', value: ['Tag 1', 'Tag 2'], expected: 1 },
      { op: 'isNotExactly', value: ['Tag 1', 'Tag 2'], expected: 2 },
      { op: 'isEmpty', value: null, expected: 1 },
      { op: 'isNotEmpty', value: null, expected: 2 },
    ])('$op -> $expected records', async ({ op, value, expected }) => {
      await expectFilterCount(tableId, { fieldId: tagsFieldId, operator: op, value }, expected);
    });
  });

  // ------------------------------------------------------------------
  // User (single + multiple)
  // v1: USER_FIELD_CASES / MULTIPLE_USER_FIELD_CASES
  // ------------------------------------------------------------------
  describe('user field operators', () => {
    let tableId: string;
    let ownerFieldId: string;
    let assigneesFieldId: string;
    let aliceId: string;
    const bobId = 'usrFilterMatrixBob';

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix User',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Owner', type: 'user', options: { isMultiple: false } },
          { name: 'Assignees', type: 'user', options: { isMultiple: true } },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      ownerFieldId = table.fields.find((f) => f.name === 'Owner')?.id ?? '';
      assigneesFieldId = table.fields.find((f) => f.name === 'Assignees')?.id ?? '';

      aliceId = ctx.testUser.id;
      const alice = { id: aliceId, title: ctx.testUser.name };
      const bob = { id: bobId, title: 'Bob' };

      await sql`
        insert into users (id, name, email)
        values (${bob.id}, ${bob.title}, ${'bob+filter-matrix@e2e.com'})
        on conflict (id) do nothing
      `.execute(ctx.testContainer.db);

      await sql`
        insert into collaborator (id, resource_type, resource_id, principal_id, principal_type)
        values ('col' || ${bob.id}, 'base', ${ctx.baseId}, ${bob.id}, 'user')
        on conflict (id) do nothing
      `.execute(ctx.testContainer.db);

      await ctx.createRecords(tableId, [
        { fields: { [ownerFieldId]: alice, [assigneesFieldId]: [alice] } },
        { fields: { [ownerFieldId]: bob, [assigneesFieldId]: [alice, bob] } },
        { fields: {} },
      ]);
    }, 60000);

    it('single user supports is / isNot / isAnyOf / isNoneOf / isEmpty / isNotEmpty', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: ownerFieldId, operator: 'is', value: aliceId },
        1
      );
      await expectFilterCount(
        tableId,
        { fieldId: ownerFieldId, operator: 'isNot', value: aliceId },
        2
      );
      await expectFilterCount(
        tableId,
        { fieldId: ownerFieldId, operator: 'isAnyOf', value: [aliceId, bobId] },
        2
      );
      await expectFilterCount(
        tableId,
        { fieldId: ownerFieldId, operator: 'isNoneOf', value: [aliceId] },
        2
      );
      await expectFilterCount(
        tableId,
        { fieldId: ownerFieldId, operator: 'isEmpty', value: null },
        1
      );
      await expectFilterCount(
        tableId,
        { fieldId: ownerFieldId, operator: 'isNotEmpty', value: null },
        2
      );
    });

    it('multiple user supports hasAnyOf / hasAllOf / hasNoneOf / isExactly / isNotExactly / isEmpty / isNotEmpty', async () => {
      await expectFilterCount(
        tableId,
        { fieldId: assigneesFieldId, operator: 'hasAnyOf', value: [bobId] },
        1
      );
      await expectFilterCount(
        tableId,
        { fieldId: assigneesFieldId, operator: 'hasAllOf', value: [aliceId, bobId] },
        1
      );
      await expectFilterCount(
        tableId,
        { fieldId: assigneesFieldId, operator: 'hasNoneOf', value: [bobId] },
        2
      );
      await expectFilterCount(
        tableId,
        { fieldId: assigneesFieldId, operator: 'isExactly', value: [aliceId] },
        1
      );
      await expectFilterCount(
        tableId,
        { fieldId: assigneesFieldId, operator: 'isNotExactly', value: [aliceId, bobId] },
        2
      );
      await expectFilterCount(
        tableId,
        { fieldId: assigneesFieldId, operator: 'isEmpty', value: null },
        1
      );
      await expectFilterCount(
        tableId,
        { fieldId: assigneesFieldId, operator: 'isNotEmpty', value: null },
        2
      );
    });
  });

  // ------------------------------------------------------------------
  // Link + lookup + rollup + formula (computed chain)
  // v1: Link/Lookup/Rollup/Formula Field Filters (comprehensive-field-filter)
  // ------------------------------------------------------------------
  describe('link, lookup, rollup and formula field operators', () => {
    let mainTableId: string;
    let linkFieldId: string;
    let lookupTextFieldId: string;
    let lookupNumberFieldId: string;
    let rollupSumFieldId: string;
    let formulaFieldId: string;

    beforeAll(async () => {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Related',
        fields: [
          { name: 'Related Text', type: 'singleLineText', isPrimary: true },
          { name: 'Related Number', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const relatedTextFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const relatedNumberFieldId =
        foreignTable.fields.find((f) => f.name === 'Related Number')?.id ?? '';

      const related1 = await ctx.createRecord(foreignTable.id, {
        [relatedTextFieldId]: 'Related Item 1',
        [relatedNumberFieldId]: 100,
      });
      const related2 = await ctx.createRecord(foreignTable.id, {
        [relatedTextFieldId]: 'Related Item 2',
        [relatedNumberFieldId]: 200,
      });

      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Main',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Number', type: 'number' },
          {
            name: 'Link',
            type: 'link',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreignTable.id,
              lookupFieldId: relatedTextFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      mainTableId = mainTable.id;
      const numberFieldId = mainTable.fields.find((f) => f.name === 'Number')?.id ?? '';
      linkFieldId = mainTable.fields.find((f) => f.name === 'Link')?.id ?? '';

      const lookupTextField = await ctx.createField({
        baseId: ctx.baseId,
        tableId: mainTableId,
        field: {
          type: 'lookup',
          name: 'Lookup Text',
          options: {
            foreignTableId: foreignTable.id,
            lookupFieldId: relatedTextFieldId,
            linkFieldId,
          },
        },
      });
      lookupTextFieldId = lookupTextField.fields.find((f) => f.name === 'Lookup Text')?.id ?? '';

      const lookupNumberField = await ctx.createField({
        baseId: ctx.baseId,
        tableId: mainTableId,
        field: {
          type: 'lookup',
          name: 'Lookup Number',
          options: {
            foreignTableId: foreignTable.id,
            lookupFieldId: relatedNumberFieldId,
            linkFieldId,
          },
        },
      });
      lookupNumberFieldId =
        lookupNumberField.fields.find((f) => f.name === 'Lookup Number')?.id ?? '';

      const rollupField = await ctx.createField({
        baseId: ctx.baseId,
        tableId: mainTableId,
        field: {
          type: 'rollup',
          name: 'Rollup Sum',
          options: { expression: 'sum({values})' },
          config: {
            foreignTableId: foreignTable.id,
            lookupFieldId: relatedNumberFieldId,
            linkFieldId,
          },
        },
      });
      rollupSumFieldId = rollupField.fields.find((f) => f.name === 'Rollup Sum')?.id ?? '';

      const formulaField = await ctx.createField({
        baseId: ctx.baseId,
        tableId: mainTableId,
        field: {
          type: 'formula',
          name: 'Doubled',
          options: { expression: `{${numberFieldId}} * 2` },
        },
      });
      formulaFieldId = formulaField.fields.find((f) => f.name === 'Doubled')?.id ?? '';

      await ctx.createRecords(mainTableId, [
        {
          fields: {
            [numberFieldId]: 10.5,
            [linkFieldId]: { id: related1.id },
          },
        },
        {
          fields: {
            [numberFieldId]: 25.75,
            [linkFieldId]: { id: related2.id },
          },
        },
        { fields: {} },
      ]);
    }, 120000);

    it('link supports isEmpty / isNotEmpty', async () => {
      await expectFilterCount(
        mainTableId,
        { fieldId: linkFieldId, operator: 'isEmpty', value: null },
        1
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: linkFieldId, operator: 'isNotEmpty', value: null },
        2
      );
    });

    it('lookup text supports is / contains / isEmpty / isNotEmpty', async () => {
      await expectFilterCount(
        mainTableId,
        { fieldId: lookupTextFieldId, operator: 'is', value: 'Related Item 1' },
        1
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: lookupTextFieldId, operator: 'contains', value: 'Related' },
        2
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: lookupTextFieldId, operator: 'isEmpty', value: null },
        1
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: lookupTextFieldId, operator: 'isNotEmpty', value: null },
        2
      );
    });

    it('lookup number supports is / isGreater / isEmpty / isNotEmpty', async () => {
      await expectFilterCount(
        mainTableId,
        { fieldId: lookupNumberFieldId, operator: 'is', value: 100 },
        1
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: lookupNumberFieldId, operator: 'isGreater', value: 150 },
        1
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: lookupNumberFieldId, operator: 'isEmpty', value: null },
        1
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: lookupNumberFieldId, operator: 'isNotEmpty', value: null },
        2
      );
    });

    it('rollup sum supports is / isGreater / isLess / isEmpty / isNotEmpty (v1: sum over no links is 0)', async () => {
      await expectFilterCount(
        mainTableId,
        { fieldId: rollupSumFieldId, operator: 'is', value: 100 },
        1
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: rollupSumFieldId, operator: 'isGreater', value: 150 },
        1
      );
      // v1 comprehensive-field-filter: unlinked row rolls up to 0 → isLess 150 -> 2
      await expectFilterCount(
        mainTableId,
        { fieldId: rollupSumFieldId, operator: 'isLess', value: 150 },
        2
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: rollupSumFieldId, operator: 'isEmpty', value: null },
        0
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: rollupSumFieldId, operator: 'isNotEmpty', value: null },
        3
      );
    });

    it('number formula supports is / isGreater / isLess / isEmpty / isNotEmpty (v1: blank input evaluates to 0)', async () => {
      await expectFilterCount(
        mainTableId,
        { fieldId: formulaFieldId, operator: 'is', value: 21 },
        1
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: formulaFieldId, operator: 'isGreater', value: 30 },
        1
      );
      // v1 comprehensive-field-filter: {blank} * 2 evaluates to 0 → isLess 30 -> 2
      await expectFilterCount(
        mainTableId,
        { fieldId: formulaFieldId, operator: 'isLess', value: 30 },
        2
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: formulaFieldId, operator: 'isEmpty', value: null },
        0
      );
      await expectFilterCount(
        mainTableId,
        { fieldId: formulaFieldId, operator: 'isNotEmpty', value: null },
        3
      );
    });
  });

  // ------------------------------------------------------------------
  // Group composition (AND / OR / nested, T3109)
  // v1: Complex Filter Scenarios + T3109 nested filter conjunction
  // ------------------------------------------------------------------
  describe('filter group composition', () => {
    let tableId: string;
    let textFieldId: string;
    let numberFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Filter Matrix Groups',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Text', type: 'singleLineText' },
          { name: 'Number', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Number')?.id ?? '';

      await ctx.createRecords(tableId, [
        { fields: { [textFieldId]: 'Test Text 1', [numberFieldId]: 10.5 } },
        { fields: { [textFieldId]: 'Test Text 2', [numberFieldId]: 25.75 } },
        { fields: {} },
      ]);
    }, 60000);

    it('combines conditions with AND', async () => {
      await expectFilterCount(
        tableId,
        {
          conjunction: 'and',
          items: [
            { fieldId: textFieldId, operator: 'is', value: 'Test Text 1' },
            { fieldId: numberFieldId, operator: 'is', value: 10.5 },
          ],
        },
        1
      );
    });

    it('combines a condition and a nested group with OR', async () => {
      await expectFilterCount(
        tableId,
        {
          conjunction: 'or',
          items: [
            { fieldId: textFieldId, operator: 'isEmpty', value: null },
            {
              conjunction: 'and',
              items: [{ fieldId: numberFieldId, operator: 'isGreater', value: 20 }],
            },
          ],
        },
        2
      );
    });

    it('T3109: middle-level OR conjunction is preserved in 3-level nesting', async () => {
      // Root(AND) → Group1(OR) → [Number=10.5, Group2(AND) → [Number=25.75]]
      const records = await listWithFilter(tableId, {
        conjunction: 'and',
        items: [
          {
            conjunction: 'or',
            items: [
              { fieldId: numberFieldId, operator: 'is', value: 10.5 },
              {
                conjunction: 'and',
                items: [{ fieldId: numberFieldId, operator: 'is', value: 25.75 }],
              },
            ],
          },
        ],
      });
      const numbers = records
        .map((record) => record.fields[numberFieldId])
        .sort((a, b) => Number(a) - Number(b));
      expect(numbers).toEqual([10.5, 25.75]);
    });
  });
});
