/* eslint-disable @typescript-eslint/naming-convention */
import { RecordsBatchUpdated } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

let fieldIdCounter = 0;
let tableNameCounter = 0;

const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const createTableName = (prefix: string) => `${prefix}_${tableNameCounter++}`;

const deleteTableSafe = async (ctx: SharedTestContext, tableId: string | undefined) => {
  if (!tableId) return;
  try {
    await ctx.deleteTable(tableId);
  } catch {
    return undefined;
  }
};

const listRecordVersions = async (ctx: SharedTestContext, tableId: string) => {
  const result = await sql<{ __id: string; __version: number }>`
    SELECT "__id", "__version"
    FROM ${sql.table(`${ctx.baseId}.${tableId}`)}
  `.execute(ctx.testContainer.db);

  return new Map(result.rows.map((row) => [row.__id, row.__version]));
};

const listSummaryValues = async (
  ctx: SharedTestContext,
  tableId: string,
  fieldId: string
): Promise<Map<string, number>> => {
  const records = await ctx.listRecords(tableId);
  return new Map(records.map((record) => [record.id, Number(record.fields[fieldId] ?? 0)]));
};

const getComputedSummaryEvents = (
  ctx: SharedTestContext,
  summaryTableId: string,
  beforeEventCount: number
) => {
  const newEvents = ctx.testContainer.eventBus.events().slice(beforeEventCount);
  return newEvents.filter(
    (event): event is RecordsBatchUpdated =>
      event instanceof RecordsBatchUpdated &&
      event.source === 'computed' &&
      event.tableId.toString() === summaryTableId
  );
};

const expectSummaryValues = async (
  ctx: SharedTestContext,
  tableId: string,
  fieldId: string,
  expected: number
) => {
  const values = await listSummaryValues(ctx, tableId, fieldId);
  expect(new Set(values.values())).toEqual(new Set([expected]));
};

const expectSummaryVersions = (
  versions: ReadonlyMap<string, number>,
  recordIds: ReadonlyArray<string>,
  previous: ReadonlyMap<string, number>,
  delta: number
) => {
  for (const recordId of recordIds) {
    expect(versions.get(recordId)).toBe((previous.get(recordId) ?? 0) + delta);
  }
};

const expectComputedSummaryUpdateIds = (
  events: ReadonlyArray<RecordsBatchUpdated>,
  expectedRecordIds: ReadonlyArray<string>
) => {
  const updatedRecordIds = new Set(
    events.flatMap((event) => event.updates.map((update) => update.recordId))
  );
  expect([...updatedRecordIds].sort()).toStrictEqual([...expectedRecordIds].sort());
};

const createScenario = async (ctx: SharedTestContext) => {
  let leafTableId: string | undefined;
  let bridgeTableId: string | undefined;
  let summaryTableId: string | undefined;

  try {
    const leafNameFieldId = createFieldId();
    const leafAmountFieldId = createFieldId();
    const bridgeNameFieldId = createFieldId();
    const bridgeIncludeFieldId = createFieldId();
    const bridgeLeafLinkFieldId = createFieldId();
    const bridgeLeafAmountFieldId = createFieldId();
    const summaryNameFieldId = createFieldId();
    const summaryConditionalRollupFieldId = createFieldId();

    const leafTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: createTableName('leaf'),
      fields: [
        { type: 'singleLineText', id: leafNameFieldId, name: 'LeafName', isPrimary: true },
        { type: 'number', id: leafAmountFieldId, name: 'LeafAmount' },
      ],
      views: [{ type: 'grid' }],
    });
    leafTableId = leafTable.id;

    const bridgeTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: createTableName('bridge'),
      fields: [
        { type: 'singleLineText', id: bridgeNameFieldId, name: 'BridgeName', isPrimary: true },
        { type: 'checkbox', id: bridgeIncludeFieldId, name: 'IncludeInSummary' },
        {
          type: 'link',
          id: bridgeLeafLinkFieldId,
          name: 'LeafRef',
          options: {
            relationship: 'manyOne',
            foreignTableId: leafTable.id,
            lookupFieldId: leafNameFieldId,
          },
        },
        {
          type: 'rollup',
          id: bridgeLeafAmountFieldId,
          name: 'LeafTotal',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId: bridgeLeafLinkFieldId,
            foreignTableId: leafTable.id,
            lookupFieldId: leafAmountFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    bridgeTableId = bridgeTable.id;

    const summaryTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: createTableName('summary'),
      fields: [
        { type: 'singleLineText', id: summaryNameFieldId, name: 'SummaryName', isPrimary: true },
        {
          type: 'conditionalRollup',
          id: summaryConditionalRollupFieldId,
          name: 'IncludedLeafTotal',
          options: { expression: 'sum({values})' },
          config: {
            foreignTableId: bridgeTable.id,
            lookupFieldId: bridgeLeafAmountFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: bridgeIncludeFieldId,
                    operator: 'is',
                    value: true,
                  },
                ],
              },
            },
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    summaryTableId = summaryTable.id;

    const leafA = await ctx.createRecord(leafTable.id, {
      [leafNameFieldId]: 'leaf-a',
      [leafAmountFieldId]: 10,
    });
    const leafB = await ctx.createRecord(leafTable.id, {
      [leafNameFieldId]: 'leaf-b',
      [leafAmountFieldId]: 30,
    });
    const leafExcluded = await ctx.createRecord(leafTable.id, {
      [leafNameFieldId]: 'leaf-excluded',
      [leafAmountFieldId]: 90,
    });
    const leafSpare = await ctx.createRecord(leafTable.id, {
      [leafNameFieldId]: 'leaf-spare',
      [leafAmountFieldId]: 50,
    });

    const bridgeIncluded = await ctx.createRecord(bridgeTable.id, {
      [bridgeNameFieldId]: 'bridge-included',
      [bridgeIncludeFieldId]: true,
      [bridgeLeafLinkFieldId]: { id: leafA.id },
    });
    const bridgeExcluded = await ctx.createRecord(bridgeTable.id, {
      [bridgeNameFieldId]: 'bridge-excluded',
      [bridgeIncludeFieldId]: false,
      [bridgeLeafLinkFieldId]: { id: leafExcluded.id },
    });

    const summaryA = await ctx.createRecord(summaryTable.id, {
      [summaryNameFieldId]: 'summary-a',
    });
    const summaryB = await ctx.createRecord(summaryTable.id, {
      [summaryNameFieldId]: 'summary-b',
    });

    await ctx.drainOutbox();

    return {
      cleanup: async () => {
        await deleteTableSafe(ctx, summaryTableId);
        await deleteTableSafe(ctx, bridgeTableId);
        await deleteTableSafe(ctx, leafTableId);
      },
      ids: {
        leafTableId: leafTable.id,
        leafAmountFieldId,
        bridgeTableId: bridgeTable.id,
        bridgeNameFieldId,
        bridgeIncludeFieldId,
        bridgeLeafLinkFieldId,
        summaryTableId: summaryTable.id,
        summaryConditionalRollupFieldId,
        summaryRecordIds: [summaryA.id, summaryB.id],
      },
      records: {
        leafA,
        leafB,
        leafExcluded,
        leafSpare,
        bridgeIncluded,
        bridgeExcluded,
      },
    };
  } catch (error) {
    await deleteTableSafe(ctx, summaryTableId);
    await deleteTableSafe(ctx, bridgeTableId);
    await deleteTableSafe(ctx, leafTableId);
    throw error;
  }
};

describe('conditional rollup simple-filter fast path (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('keeps summary values correct across create, value, filter, link, and delete changes', async () => {
    const scenario = await createScenario(ctx);
    const {
      cleanup,
      ids: {
        leafTableId,
        leafAmountFieldId,
        bridgeTableId,
        bridgeNameFieldId,
        bridgeIncludeFieldId,
        bridgeLeafLinkFieldId,
        summaryTableId,
        summaryConditionalRollupFieldId,
        summaryRecordIds,
      },
      records: { leafA, leafB, leafSpare, bridgeIncluded },
    } = scenario;

    try {
      await expectSummaryValues(ctx, summaryTableId, summaryConditionalRollupFieldId, 10);
      let previousVersions = await listRecordVersions(ctx, summaryTableId);

      const createdBridge = await ctx.createRecord(bridgeTableId, {
        [bridgeNameFieldId]: 'bridge-created',
        [bridgeIncludeFieldId]: true,
        [bridgeLeafLinkFieldId]: { id: leafB.id },
      });

      let beforeEventCount = ctx.testContainer.eventBus.events().length;
      await ctx.drainOutbox();
      await expectSummaryValues(ctx, summaryTableId, summaryConditionalRollupFieldId, 40);
      let nextVersions = await listRecordVersions(ctx, summaryTableId);
      expectSummaryVersions(nextVersions, summaryRecordIds, previousVersions, 1);
      expectComputedSummaryUpdateIds(
        getComputedSummaryEvents(ctx, summaryTableId, beforeEventCount),
        summaryRecordIds
      );
      previousVersions = nextVersions;

      beforeEventCount = ctx.testContainer.eventBus.events().length;
      await ctx.updateRecord(leafTableId, leafA.id, {
        [leafAmountFieldId]: 15,
      });
      await ctx.drainOutbox();
      await expectSummaryValues(ctx, summaryTableId, summaryConditionalRollupFieldId, 45);
      nextVersions = await listRecordVersions(ctx, summaryTableId);
      expectSummaryVersions(nextVersions, summaryRecordIds, previousVersions, 1);
      expectComputedSummaryUpdateIds(
        getComputedSummaryEvents(ctx, summaryTableId, beforeEventCount),
        summaryRecordIds
      );
      previousVersions = nextVersions;

      beforeEventCount = ctx.testContainer.eventBus.events().length;
      await ctx.updateRecord(bridgeTableId, bridgeIncluded.id, {
        [bridgeIncludeFieldId]: false,
      });
      await ctx.drainOutbox();
      await expectSummaryValues(ctx, summaryTableId, summaryConditionalRollupFieldId, 30);
      nextVersions = await listRecordVersions(ctx, summaryTableId);
      expectSummaryVersions(nextVersions, summaryRecordIds, previousVersions, 1);
      expectComputedSummaryUpdateIds(
        getComputedSummaryEvents(ctx, summaryTableId, beforeEventCount),
        summaryRecordIds
      );
      previousVersions = nextVersions;

      beforeEventCount = ctx.testContainer.eventBus.events().length;
      await ctx.updateRecord(bridgeTableId, createdBridge.id, {
        [bridgeLeafLinkFieldId]: { id: leafSpare.id },
      });
      await ctx.drainOutbox();
      await expectSummaryValues(ctx, summaryTableId, summaryConditionalRollupFieldId, 50);
      nextVersions = await listRecordVersions(ctx, summaryTableId);
      expectSummaryVersions(nextVersions, summaryRecordIds, previousVersions, 1);
      expectComputedSummaryUpdateIds(
        getComputedSummaryEvents(ctx, summaryTableId, beforeEventCount),
        summaryRecordIds
      );
      previousVersions = nextVersions;

      beforeEventCount = ctx.testContainer.eventBus.events().length;
      await ctx.deleteRecord(leafTableId, leafSpare.id);
      await ctx.drainOutbox();
      await expectSummaryValues(ctx, summaryTableId, summaryConditionalRollupFieldId, 0);
      nextVersions = await listRecordVersions(ctx, summaryTableId);
      expectSummaryVersions(nextVersions, summaryRecordIds, previousVersions, 1);
      expectComputedSummaryUpdateIds(
        getComputedSummaryEvents(ctx, summaryTableId, beforeEventCount),
        summaryRecordIds
      );
    } finally {
      await cleanup();
    }
  });

  test('does not update summary rows for excluded source changes', async () => {
    const scenario = await createScenario(ctx);
    const {
      cleanup,
      ids: {
        leafTableId,
        leafAmountFieldId,
        summaryTableId,
        summaryConditionalRollupFieldId,
        summaryRecordIds,
      },
      records: { leafExcluded },
    } = scenario;

    try {
      await expectSummaryValues(ctx, summaryTableId, summaryConditionalRollupFieldId, 10);
      const previousVersions = await listRecordVersions(ctx, summaryTableId);
      const beforeEventCount = ctx.testContainer.eventBus.events().length;

      await ctx.updateRecord(leafTableId, leafExcluded.id, {
        [leafAmountFieldId]: 120,
      });
      await ctx.drainOutbox();

      await expectSummaryValues(ctx, summaryTableId, summaryConditionalRollupFieldId, 10);
      const nextVersions = await listRecordVersions(ctx, summaryTableId);
      expectSummaryVersions(nextVersions, summaryRecordIds, previousVersions, 0);
      expect(getComputedSummaryEvents(ctx, summaryTableId, beforeEventCount)).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  /**
   * Sanitized structure-equivalent of the BYODB overload:
   * - 826 target rows and 27 conditional rollups over three low-cardinality filters
   * - one filter-only source edit dirties every target while leaving every aggregate unchanged
   * - computed SQL must scan the source once per 16-field execution chunk, not once per condition
   */
  test('shares source scans across many low-cardinality conditional rollups', async () => {
    const sourceName = createTableName('conditional_source');
    const targetName = createTableName('conditional_target');
    const sourcePrimaryFieldId = createFieldId();
    const sourceValueFieldId = createFieldId();
    const sourceFilterFieldIds = [createFieldId(), createFieldId(), createFieldId()];
    const choices = ['A', 'B', 'C'] as const;
    const combinations = choices.flatMap((first) =>
      choices.flatMap((second) => choices.map((third) => [first, second, third] as const))
    );
    const rollupFieldIds = combinations.map(() => createFieldId());
    let sourceTableId: string | undefined;
    let targetTableId: string | undefined;

    try {
      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: sourceName,
        fields: [
          {
            type: 'singleLineText',
            id: sourcePrimaryFieldId,
            name: 'SourceName',
            isPrimary: true,
          },
          { type: 'number', id: sourceValueFieldId, name: 'Value' },
          ...sourceFilterFieldIds.map((fieldId, index) => ({
            type: 'singleSelect' as const,
            id: fieldId,
            name: `Category${index + 1}`,
            options: {
              choices: choices.map((choice) => ({
                id: `choice_${index}_${choice.toLowerCase()}`,
                name: choice,
                color: 'gray' as const,
              })),
            },
          })),
        ],
        views: [{ type: 'grid' }],
      });
      sourceTableId = sourceTable.id;

      const targetPrimaryFieldId = createFieldId();
      const targetTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: targetName,
        fields: [
          {
            type: 'singleLineText',
            id: targetPrimaryFieldId,
            name: 'TargetName',
            isPrimary: true,
          },
          ...combinations.map((combination, index) => ({
            type: 'conditionalRollup' as const,
            id: rollupFieldIds[index]!,
            name: `Summary${index + 1}`,
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and' as const,
                  filterSet: sourceFilterFieldIds.map((fieldId, filterIndex) => ({
                    fieldId,
                    operator: 'is',
                    value: combination[filterIndex],
                  })),
                },
              },
            },
          })),
        ],
        views: [{ type: 'grid' }],
      });
      targetTableId = targetTable.id;

      const sourceRecords = await ctx.createRecords(
        sourceTable.id,
        combinations.map((combination, index) => ({
          fields: {
            [sourcePrimaryFieldId]: `source-${index + 1}`,
            [sourceValueFieldId]: index === 0 ? 0 : 1,
            ...Object.fromEntries(
              sourceFilterFieldIds.map((fieldId, filterIndex) => [
                fieldId,
                `choice_${filterIndex}_${combination[filterIndex].toLowerCase()}`,
              ])
            ),
          },
        }))
      );
      await ctx.createRecords(
        targetTable.id,
        Array.from({ length: 826 }, (_, index) => ({
          fields: { [targetPrimaryFieldId]: `target-${index + 1}` },
        }))
      );
      await ctx.drainOutbox();

      const previousTargetVersions = await listRecordVersions(ctx, targetTable.id);
      const beforeEventCount = ctx.testContainer.eventBus.events().length;

      ctx.clearLogs();
      await ctx.updateRecord(sourceTable.id, sourceRecords[0]!.id, {
        [sourceFilterFieldIds[0]!]: 'choice_0_b',
      });
      await ctx.drainOutbox();

      // Stage budgets may split the 27-edge plan across several bounded stages;
      // aggregate the logged stage plans to assert full coverage.
      const plans = ctx.testContainer.getComputedPlans() as Array<{
        steps?: Array<{ tableId?: string; fieldIds?: string[] }>;
        edges?: Array<{ to?: string; propagationMode?: string }>;
      }>;
      const targetEdges = plans
        .flatMap((plan) => plan.edges ?? [])
        .filter((edge) => rollupFieldIds.some((fieldId) => edge.to?.endsWith(`.${fieldId}`)));
      const coveredEdgeTargets = new Set(targetEdges.map((edge) => edge.to));
      expect(coveredEdgeTargets.size).toBe(rollupFieldIds.length);
      expect(
        targetEdges.every((edge) =>
          ['allTargetRecords', 'conditionalFiltered'].includes(edge.propagationMode ?? '')
        )
      ).toBe(true);
      const targetStageSteps = plans
        .flatMap((plan) => plan.steps ?? [])
        .filter((step) => step.tableId === targetTable.id);
      const coveredStepFieldIds = new Set(targetStageSteps.flatMap((step) => step.fieldIds ?? []));
      expect(coveredStepFieldIds.size).toBe(rollupFieldIds.length);

      const sqlEntries = ctx.testContainer.spyLogger
        .getEntriesByMessage(/computed:update:/)
        .map((entry) => entry.message);
      const sourceTableToken = `."${sourceTable.id}" as "f"`;
      const sourceScanCount = sqlEntries.reduce(
        (total, message) => total + message.split(sourceTableToken).length - 1,
        0
      );
      // Scans are shared across all rollups within a stage: at most one scan per
      // 16-field chunk per logged stage plan (plans that only planned, e.g. the
      // hybrid sync phase, may not execute the target update at all), and never
      // one scan per rollup field.
      const maxExpectedFieldChunks = targetStageSteps.reduce(
        (total, step) => total + Math.ceil((step.fieldIds?.length ?? 0) / 16),
        0
      );
      expect(sourceScanCount).toBeGreaterThan(0);
      expect(sourceScanCount).toBeLessThanOrEqual(maxExpectedFieldChunks);
      expect(sourceScanCount).toBeLessThan(rollupFieldIds.length);

      expect(await listRecordVersions(ctx, targetTable.id)).toEqual(previousTargetVersions);
      expect(getComputedSummaryEvents(ctx, targetTable.id, beforeEventCount)).toHaveLength(0);

      const targetRecords = await ctx.listRecords(targetTable.id);
      for (const record of targetRecords) {
        expect(Number(record.fields[rollupFieldIds[0]!] ?? 0)).toBe(0);
        expect(Number(record.fields[rollupFieldIds[9]!] ?? 0)).toBe(1);
      }
    } finally {
      await deleteTableSafe(ctx, targetTableId);
      await deleteTableSafe(ctx, sourceTableId);
    }
  }, 180_000);

  /**
   * Sanitized structure-equivalent of the private-deploy dual-key timeout:
   * - host and source both have Name (text) and Code (number)
   * - two order-insensitive sums filter on Name is {host.Name} AND Code is {host.Code}
   * - overlapping names with distinct codes must not share aggregates
   * - computed SQL must use a set-based host join, not per-row LATERAL
   */
  test('uses set-based host join for composite field-reference equality filters', async () => {
    const sourceName = createTableName('composite_source');
    const hostName = createTableName('composite_host');
    const sourceNameFieldId = createFieldId();
    const sourceCodeFieldId = createFieldId();
    const sourceDebitFieldId = createFieldId();
    const sourceCreditFieldId = createFieldId();
    const hostNameFieldId = createFieldId();
    const hostCodeFieldId = createFieldId();
    const debitRollupFieldId = createFieldId();
    const creditRollupFieldId = createFieldId();
    let sourceTableId: string | undefined;
    let hostTableId: string | undefined;

    const compositeFilter = {
      conjunction: 'and' as const,
      filterSet: [
        {
          fieldId: sourceNameFieldId,
          operator: 'is',
          value: { type: 'field', fieldId: hostNameFieldId },
        },
        {
          fieldId: sourceCodeFieldId,
          operator: 'is',
          value: { type: 'field', fieldId: hostCodeFieldId },
        },
      ],
    };

    try {
      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: sourceName,
        fields: [
          {
            type: 'singleLineText',
            id: sourceNameFieldId,
            name: 'ProjectName',
            isPrimary: true,
          },
          { type: 'number', id: sourceCodeFieldId, name: 'ProjectCode' },
          { type: 'number', id: sourceDebitFieldId, name: 'DebitAmount' },
          { type: 'number', id: sourceCreditFieldId, name: 'CreditAmount' },
        ],
        views: [{ type: 'grid' }],
      });
      sourceTableId = sourceTable.id;

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: hostName,
        fields: [
          {
            type: 'singleLineText',
            id: hostNameFieldId,
            name: 'ProjectName',
            isPrimary: true,
          },
          { type: 'number', id: hostCodeFieldId, name: 'ProjectCode' },
          {
            type: 'conditionalRollup',
            id: debitRollupFieldId,
            name: 'DebitTotal',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceDebitFieldId,
              condition: { filter: compositeFilter },
            },
          },
          {
            type: 'conditionalRollup',
            id: creditRollupFieldId,
            name: 'CreditTotal',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceCreditFieldId,
              condition: { filter: compositeFilter },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      hostTableId = hostTable.id;

      await ctx.createRecords(sourceTable.id, [
        {
          fields: {
            [sourceNameFieldId]: 'alpha',
            [sourceCodeFieldId]: 1,
            [sourceDebitFieldId]: 10,
            [sourceCreditFieldId]: 1,
          },
        },
        {
          fields: {
            [sourceNameFieldId]: 'alpha',
            [sourceCodeFieldId]: 1,
            [sourceDebitFieldId]: 5,
            [sourceCreditFieldId]: 2,
          },
        },
        {
          fields: {
            [sourceNameFieldId]: 'alpha',
            [sourceCodeFieldId]: 2,
            [sourceDebitFieldId]: 40,
            [sourceCreditFieldId]: 4,
          },
        },
        {
          fields: {
            [sourceNameFieldId]: 'beta',
            [sourceCodeFieldId]: 1,
            [sourceDebitFieldId]: 7,
            [sourceCreditFieldId]: 3,
          },
        },
      ]);
      const hostRecords = await ctx.createRecords(hostTable.id, [
        { fields: { [hostNameFieldId]: 'alpha', [hostCodeFieldId]: 1 } },
        { fields: { [hostNameFieldId]: 'alpha', [hostCodeFieldId]: 2 } },
        { fields: { [hostNameFieldId]: 'beta', [hostCodeFieldId]: 1 } },
      ]);
      await ctx.drainOutbox();

      const listed = await ctx.listRecords(hostTable.id);
      const byId = new Map(listed.map((record) => [record.id, record]));
      expect(Number(byId.get(hostRecords[0]!.id)?.fields[debitRollupFieldId] ?? 0)).toBe(15);
      expect(Number(byId.get(hostRecords[0]!.id)?.fields[creditRollupFieldId] ?? 0)).toBe(3);
      expect(Number(byId.get(hostRecords[1]!.id)?.fields[debitRollupFieldId] ?? 0)).toBe(40);
      expect(Number(byId.get(hostRecords[1]!.id)?.fields[creditRollupFieldId] ?? 0)).toBe(4);
      expect(Number(byId.get(hostRecords[2]!.id)?.fields[debitRollupFieldId] ?? 0)).toBe(7);
      expect(Number(byId.get(hostRecords[2]!.id)?.fields[creditRollupFieldId] ?? 0)).toBe(3);

      ctx.clearLogs();
      await ctx.updateRecord(sourceTable.id, (await ctx.listRecords(sourceTable.id))[0]!.id, {
        [sourceDebitFieldId]: 11,
      });
      await ctx.drainOutbox();

      const sqlEntries = ctx.testContainer.spyLogger
        .getEntriesByMessage(/computed:update:/)
        .map((entry) => entry.message)
        .join('\n');
      expect(sqlEntries).toContain(`"${hostTable.id}"`);
      expect(sqlEntries.toLowerCase()).not.toContain('inner join lateral');
      expect(sqlEntries).toContain('left join');

      const afterUpdate = await ctx.listRecords(hostTable.id);
      const afterById = new Map(afterUpdate.map((record) => [record.id, record]));
      expect(Number(afterById.get(hostRecords[0]!.id)?.fields[debitRollupFieldId] ?? 0)).toBe(16);
      expect(Number(afterById.get(hostRecords[1]!.id)?.fields[debitRollupFieldId] ?? 0)).toBe(40);
      expect(Number(afterById.get(hostRecords[2]!.id)?.fields[debitRollupFieldId] ?? 0)).toBe(7);
    } finally {
      await deleteTableSafe(ctx, hostTableId);
      await deleteTableSafe(ctx, sourceTableId);
    }
  });
});
