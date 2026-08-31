/* eslint-disable @typescript-eslint/naming-convention */
/**
 * V1-parity coverage for conditional rollup date filters (T6520).
 * Ports the portable cases from
 * apps/nestjs-backend/test/conditional-rollup.e2e-spec.ts:
 * - "dynamic date filters": the today mode is covered by computed.e2e.spec.ts
 *   ("only counts foreign rows whose date is today with a dynamic today filter");
 *   this file covers the remaining dynamic modes from the T6520 drift list:
 *   lastWeek / currentMonth / daysAgo, plus a plain rollup with a dynamic
 *   date filter in its config.
 * - "date field reference filters": is / isAfter / isBefore / isOnOrBefore /
 *   isOnOrAfter comparisons against a host date field reference.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('v2 conditional rollup dynamic date filters (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;
  const runId = Math.random().toString(36).slice(2, 8).padEnd(6, '0');

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(10, '0');
    fieldIdCounter += 1;
    return `fld${runId}${suffix}`;
  };

  const drainOutbox = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('dynamic date filters', () => {
    interface DynamicDateFixture {
      foreignTableId: string;
      hostTableId: string;
      hostRecordId: string;
      rollupFieldId: string;
      foreignRecords: Array<{ id: string }>;
    }

    const setupDynamicDateFixture = async (options: {
      namePrefix: string;
      expression: string;
      filterValue: Record<string, unknown>;
      foreignRows: Array<{ name: string; date: string | null; hours: number }>;
      dateFieldIdOut?: (fieldId: string) => void;
      hoursFieldIdOut?: (fieldId: string) => void;
    }): Promise<DynamicDateFixture & { dateFieldId: string; hoursFieldId: string }> => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignDateFieldId = createFieldId();
      const foreignHoursFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const rollupFieldId = createFieldId();

      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: `${options.namePrefix} Foreign`,
        fields: [
          { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Task', isPrimary: true },
          { type: 'date', id: foreignDateFieldId, name: 'Due Date' },
          { type: 'number', id: foreignHoursFieldId, name: 'Hours' },
        ],
      });

      const foreignRecords: Array<{ id: string }> = [];
      for (const row of options.foreignRows) {
        const record = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: row.name,
          [foreignDateFieldId]: row.date,
          [foreignHoursFieldId]: row.hours,
        });
        foreignRecords.push({ id: record.id });
      }

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: `${options.namePrefix} Host`,
        fields: [
          { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          {
            type: 'conditionalRollup',
            id: rollupFieldId,
            name: 'Dynamic Date Rollup',
            options: { expression: options.expression },
            config: {
              foreignTableId: foreign.id,
              lookupFieldId: foreignHoursFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignDateFieldId,
                      operator: 'is',
                      value: options.filterValue,
                    },
                  ],
                },
              },
            },
          },
        ],
      });

      const hostRecord = await ctx.createRecord(host.id, { [hostPrimaryFieldId]: 'Holder' });
      await drainOutbox();

      return {
        foreignTableId: foreign.id,
        hostTableId: host.id,
        hostRecordId: hostRecord.id,
        rollupFieldId,
        foreignRecords,
        dateFieldId: foreignDateFieldId,
        hoursFieldId: foreignHoursFieldId,
      };
    };

    const readRollupValue = async (fixture: DynamicDateFixture) => {
      const records = await ctx.listRecords(fixture.hostTableId);
      const record = records.find((r) => r.id === fixture.hostRecordId);
      return record?.fields[fixture.rollupFieldId];
    };

    it('honors lastWeek filters in conditional rollups and reacts to updates', async () => {
      let fixture: Awaited<ReturnType<typeof setupDynamicDateFixture>> | undefined;
      try {
        fixture = await setupDynamicDateFixture({
          namePrefix: 'CondRollupLastWeek',
          expression: 'sum({values})',
          filterValue: { mode: 'lastWeek', timeZone: 'UTC' },
          foreignRows: [
            { name: 'last-week-row', date: isoDaysAgo(7), hours: 5 },
            { name: 'today-row', date: isoDaysAgo(0), hours: 3 },
            { name: 'old-row', date: isoDaysAgo(30), hours: 7 },
          ],
        });

        expect(await readRollupValue(fixture)).toEqual(5);

        // Move the old row into last week; the rollup must recompute.
        await ctx.updateRecord(fixture.foreignTableId, fixture.foreignRecords[2].id, {
          [fixture.dateFieldId]: isoDaysAgo(7),
        });
        await drainOutbox();

        expect(await readRollupValue(fixture)).toEqual(12);
      } finally {
        if (fixture) {
          await ctx.deleteTable(fixture.hostTableId).catch(() => undefined);
          await ctx.deleteTable(fixture.foreignTableId).catch(() => undefined);
        }
      }
    });

    it('honors currentMonth filters in conditional rollups and reacts to updates', async () => {
      let fixture: Awaited<ReturnType<typeof setupDynamicDateFixture>> | undefined;
      try {
        fixture = await setupDynamicDateFixture({
          namePrefix: 'CondRollupCurrentMonth',
          expression: 'countall({values})',
          filterValue: { mode: 'currentMonth', timeZone: 'UTC' },
          foreignRows: [
            { name: 'this-month-row', date: isoDaysAgo(0), hours: 4 },
            { name: 'old-row', date: isoDaysAgo(40), hours: 6 },
          ],
        });

        expect(await readRollupValue(fixture)).toEqual(1);

        // Move the old row into the current month; the rollup must recompute.
        await ctx.updateRecord(fixture.foreignTableId, fixture.foreignRecords[1].id, {
          [fixture.dateFieldId]: isoDaysAgo(0),
        });
        await drainOutbox();

        expect(await readRollupValue(fixture)).toEqual(2);
      } finally {
        if (fixture) {
          await ctx.deleteTable(fixture.hostTableId).catch(() => undefined);
          await ctx.deleteTable(fixture.foreignTableId).catch(() => undefined);
        }
      }
    });

    it('honors daysAgo filters in conditional rollups', async () => {
      let fixture: Awaited<ReturnType<typeof setupDynamicDateFixture>> | undefined;
      try {
        fixture = await setupDynamicDateFixture({
          namePrefix: 'CondRollupDaysAgo',
          expression: 'countall({values})',
          filterValue: { mode: 'daysAgo', numberOfDays: 3, timeZone: 'UTC' },
          foreignRows: [
            { name: 'three-days-ago-row', date: isoDaysAgo(3), hours: 4 },
            { name: 'today-row', date: isoDaysAgo(0), hours: 2 },
            { name: 'ten-days-ago-row', date: isoDaysAgo(10), hours: 6 },
          ],
        });

        expect(await readRollupValue(fixture)).toEqual(1);
      } finally {
        if (fixture) {
          await ctx.deleteTable(fixture.hostTableId).catch(() => undefined);
          await ctx.deleteTable(fixture.foreignTableId).catch(() => undefined);
        }
      }
    });

    // v1: conditional-rollup.e2e-spec.ts "should honor today filters in rollups"
    // (dynamic date filter on a plain rollup's lookup options), transposed to lastWeek.
    it('honors dynamic date filters on plain rollup fields', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignDateFieldId = createFieldId();
      const foreignHoursFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const rollupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupDynamicDate Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Task', isPrimary: true },
            { type: 'date', id: foreignDateFieldId, name: 'Due Date' },
            { type: 'number', id: foreignHoursFieldId, name: 'Hours' },
          ],
        });
        foreignTableId = foreign.id;

        const lastWeekRow = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'last-week-row',
          [foreignDateFieldId]: isoDaysAgo(7),
          [foreignHoursFieldId]: 5,
        });
        const todayRow = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'today-row',
          [foreignDateFieldId]: isoDaysAgo(0),
          [foreignHoursFieldId]: 3,
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'RollupDynamicDate Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Tasks',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'rollup',
            id: rollupFieldId,
            name: 'Last Week Hours',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: foreign.id,
              lookupFieldId: foreignHoursFieldId,
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: foreignDateFieldId,
                    operator: 'is',
                    value: { mode: 'lastWeek', timeZone: 'UTC' },
                  },
                ],
              },
            },
          },
        });

        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Holder',
          [hostLinkFieldId]: [{ id: lastWeekRow.id }, { id: todayRow.id }],
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const record = records.find((r) => r.id === hostRecord.id);
        expect(record?.fields[rollupFieldId]).toEqual(5);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });
  });

  describe('date field reference filters', () => {
    // v1: conditional-rollup.e2e-spec.ts "date field reference filters" it.each matrix
    let foreignTableId: string;
    let hostTableId: string;
    let targetTenRecordId: string;
    let targetElevenRecordId: string;
    let targetThirteenRecordId: string;

    const foreignTaskFieldId = createFieldId();
    const foreignDueDateFieldId = createFieldId();
    const foreignHoursFieldId = createFieldId();
    const hostNameFieldId = createFieldId();
    const hostTargetDateFieldId = createFieldId();

    const dateReferenceScenarios: Array<{
      name: string;
      operator: string;
      expression: string;
      expected: [unknown, unknown, unknown];
      fieldId: string;
    }> = [
      {
        name: 'aggregates matches when due date equals host target date',
        operator: 'is',
        expression: 'count({values})',
        expected: [1, 1, 0],
        fieldId: createFieldId(),
      },
      {
        name: 'sums hours occurring after the host target date',
        operator: 'isAfter',
        expression: 'sum({values})',
        expected: [10, 7, 0],
        fieldId: createFieldId(),
      },
      {
        name: 'sums hours occurring before the host target date',
        operator: 'isBefore',
        expression: 'sum({values})',
        expected: [0, 5, 15],
        fieldId: createFieldId(),
      },
      {
        name: 'counts records on or after the host target date',
        operator: 'isOnOrAfter',
        expression: 'count({values})',
        expected: [3, 2, 0],
        fieldId: createFieldId(),
      },
      {
        name: 'counts records on or before the host target date',
        operator: 'isOnOrBefore',
        expression: 'count({values})',
        expected: [1, 2, 3],
        fieldId: createFieldId(),
      },
    ];

    beforeAll(async () => {
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CondRollupDateRef Foreign',
        fields: [
          { type: 'singleLineText', id: foreignTaskFieldId, name: 'Task', isPrimary: true },
          {
            type: 'date',
            id: foreignDueDateFieldId,
            name: 'Due Date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' },
            },
          },
          { type: 'number', id: foreignHoursFieldId, name: 'Hours' },
        ],
      });
      foreignTableId = foreign.id;

      await ctx.createRecord(foreign.id, {
        [foreignTaskFieldId]: 'Spec Draft',
        [foreignDueDateFieldId]: '2024-09-10T00:00:00.000Z',
        [foreignHoursFieldId]: 5,
      });
      await ctx.createRecord(foreign.id, {
        [foreignTaskFieldId]: 'Review',
        [foreignDueDateFieldId]: '2024-09-11T00:00:00.000Z',
        [foreignHoursFieldId]: 3,
      });
      await ctx.createRecord(foreign.id, {
        [foreignTaskFieldId]: 'Finalize',
        [foreignDueDateFieldId]: '2024-09-12T00:00:00.000Z',
        [foreignHoursFieldId]: 7,
      });

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CondRollupDateRef Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'date',
            id: hostTargetDateFieldId,
            name: 'Target Date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' },
            },
          },
        ],
      });
      hostTableId = host.id;

      for (const scenario of dateReferenceScenarios) {
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalRollup',
            id: scenario.fieldId,
            name: `date-ref ${scenario.operator} ${scenario.expression}`,
            options: { expression: scenario.expression },
            config: {
              foreignTableId: foreign.id,
              lookupFieldId: foreignHoursFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignDueDateFieldId,
                      operator: scenario.operator,
                      value: hostTargetDateFieldId,
                      isSymbol: true,
                    },
                  ],
                },
              },
            },
          },
        });
      }

      const targetTen = await ctx.createRecord(host.id, {
        [hostNameFieldId]: 'Target 09-10',
        [hostTargetDateFieldId]: '2024-09-10T12:34:56.000Z',
      });
      targetTenRecordId = targetTen.id;
      const targetEleven = await ctx.createRecord(host.id, {
        [hostNameFieldId]: 'Target 09-11',
        [hostTargetDateFieldId]: '2024-09-11T12:50:00.000Z',
      });
      targetElevenRecordId = targetEleven.id;
      const targetThirteen = await ctx.createRecord(host.id, {
        [hostNameFieldId]: 'Target 09-13',
        [hostTargetDateFieldId]: '2024-09-13T12:15:00.000Z',
      });
      targetThirteenRecordId = targetThirteen.id;

      await drainOutbox();
    });

    afterAll(async () => {
      if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
      if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
    });

    it.each(dateReferenceScenarios)('$name', async ({ fieldId, expected }) => {
      const records = await ctx.listRecords(hostTableId);
      const targetTen = records.find((record) => record.id === targetTenRecordId);
      const targetEleven = records.find((record) => record.id === targetElevenRecordId);
      const targetThirteen = records.find((record) => record.id === targetThirteenRecordId);

      expect([
        targetTen?.fields[fieldId],
        targetEleven?.fields[fieldId],
        targetThirteen?.fields[fieldId],
      ]).toEqual(expected);
    });
  });
});
