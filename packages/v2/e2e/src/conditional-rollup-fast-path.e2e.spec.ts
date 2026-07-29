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

      const targetStep = ctx
        .getLastComputedPlan()
        ?.steps.find((step) => step.tableId === targetTable.id);
      const plan = ctx.getLastComputedPlan() as
        | {
            edges?: Array<{
              to?: string;
              propagationMode?: string;
            }>;
          }
        | undefined;
      const targetEdges = plan?.edges?.filter((edge) =>
        rollupFieldIds.some((fieldId) => edge.to?.endsWith(`.${fieldId}`))
      );
      expect(targetEdges).toHaveLength(rollupFieldIds.length);
      expect(
        targetEdges?.every((edge) =>
          ['allTargetRecords', 'conditionalFiltered'].includes(edge.propagationMode ?? '')
        )
      ).toBe(true);
      expect(targetStep?.fieldIds).toHaveLength(rollupFieldIds.length);

      const sqlEntries = ctx.testContainer.spyLogger
        .getEntriesByMessage(/computed:update:/)
        .map((entry) => entry.message);
      const sourceTableToken = `."${sourceTable.id}" as "f"`;
      const sourceScanCount = sqlEntries.reduce(
        (total, message) => total + message.split(sourceTableToken).length - 1,
        0
      );
      const expectedFieldChunks = Math.ceil(rollupFieldIds.length / 16);
      expect(sourceScanCount).toBe(expectedFieldChunks);

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
});
