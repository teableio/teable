import {
  FieldId,
  TableActionTriggerRequested,
  TableByIdSpec,
  TableId,
  generatePrefixedId,
  v2CoreTokens,
  withoutTransaction,
  type BaseId,
  type DomainError,
  type Field,
  type IEventBus,
  type IExecutionContext,
  type IHasher,
  type ILogger,
  type ITableRepository,
  type IUnitOfWork,
  type Table,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB } from '../query-builder';
import type { ComputedFieldBackfillService } from './ComputedFieldBackfillService';
import type { ComputedUpdatePlanner, UpdateStep } from './ComputedUpdatePlanner';
import {
  buildFieldBackfillTaskInput,
  mergeStageNotificationTargets,
  type FieldBackfillPeriodicRefreshMeta,
  type FieldBackfillStageEntry,
} from './outbox/FieldBackfillOutboxPayload';
import type { IComputedUpdateOutbox } from './outbox/IComputedUpdateOutbox';

export const DEFAULT_PERIODIC_REFRESH_SYNC_ROW_THRESHOLD = 2000;

export type PeriodicFieldRefreshInput = {
  baseId: BaseId;
  tableId: TableId;
  fieldId: FieldId;
  syncRowThreshold?: number;
  forceAsync?: boolean;
  periodicRefreshMeta?: FieldBackfillPeriodicRefreshMeta;
};

export type PeriodicFieldRefreshExecutionResult = {
  mode: 'sync' | 'async';
  taskId?: string;
  stageCount: number;
  estimatedRowCount: number;
  updatedTableIds: string[];
};

const buildOrderedStages = (
  sourceTableId: string,
  sourceFieldId: string,
  steps: ReadonlyArray<UpdateStep>
): FieldBackfillStageEntry[] => {
  const stages: FieldBackfillStageEntry[] = [
    {
      tableId: sourceTableId,
      fieldIds: [sourceFieldId],
    },
  ];

  let prevKey: string | undefined;
  for (const step of steps) {
    const tableIdStr = step.tableId.toString();
    const fieldIds = step.fieldIds
      .map((fieldId) => fieldId.toString())
      .filter((fieldId) => !(tableIdStr === sourceTableId && fieldId === sourceFieldId));
    if (fieldIds.length === 0) continue;

    const groupKey = `${step.level}:${tableIdStr}`;
    const lastStage = stages[stages.length - 1];
    if (prevKey === groupKey && lastStage && lastStage.tableId === tableIdStr) {
      for (const fieldId of fieldIds) {
        if (!lastStage.fieldIds.includes(fieldId)) {
          lastStage.fieldIds.push(fieldId);
        }
      }
      continue;
    }

    prevKey = groupKey;
    stages.push({
      tableId: tableIdStr,
      fieldIds: [...new Set(fieldIds)],
    });
  }

  return stages;
};

/**
 * Executes or schedules a topological computed refresh starting from a time-sensitive
 * field (relative-date lookup/rollup or volatile clock formula), keeping downstream stages
 * strictly ordered and publishing `TableActionTriggerRequested('setField')` without
 * emitting `RecordsBatchUpdated`.
 */
@injectable()
export class PeriodicFieldRefreshEngine {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger,
    @inject(v2CoreTokens.hasher)
    private readonly hasher: IHasher,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: IUnitOfWork,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: IEventBus,
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly computedUpdatePlanner: ComputedUpdatePlanner,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldBackfillService)
    private readonly backfillService: ComputedFieldBackfillService,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutbox)
    private readonly outbox: IComputedUpdateOutbox
  ) {}

  async refreshField(
    context: IExecutionContext,
    input: PeriodicFieldRefreshInput
  ): Promise<Result<PeriodicFieldRefreshExecutionResult, DomainError>> {
    const syncRowThreshold = Math.max(
      0,
      Math.trunc(input.syncRowThreshold ?? DEFAULT_PERIODIC_REFRESH_SYNC_ROW_THRESHOLD)
    );

    const sourceTableResult = await this.tableRepository.findOne(
      context,
      TableByIdSpec.create(input.tableId)
    );
    if (sourceTableResult.isErr()) {
      return err(sourceTableResult.error);
    }
    const sourceTable = sourceTableResult.value;
    const sourceFieldResult = sourceTable.getField((field) => field.id().equals(input.fieldId));
    if (sourceFieldResult.isErr()) {
      return err(sourceFieldResult.error);
    }

    const planResult = await this.computedUpdatePlanner.plan(
      {
        table: sourceTable,
        changedFieldIds: [input.fieldId],
        changedRecordIds: [],
        changeType: 'update',
        cyclePolicy: 'skip',
      },
      context,
      {
        includeContextFreeFormulas: false,
      }
    );
    if (planResult.isErr()) {
      return err(planResult.error);
    }

    const stages = buildOrderedStages(
      sourceTable.id().toString(),
      input.fieldId.toString(),
      planResult.value.steps
    );

    const tableCache = new Map<string, Table>([[sourceTable.id().toString(), sourceTable]]);
    for (const stage of stages) {
      if (tableCache.has(stage.tableId)) continue;
      const stageTableIdResult = TableId.create(stage.tableId);
      if (stageTableIdResult.isErr()) continue;
      const loaded = await this.tableRepository.findOne(
        context,
        TableByIdSpec.create(stageTableIdResult.value)
      );
      if (loaded.isErr()) {
        return err(loaded.error);
      }
      tableCache.set(stage.tableId, loaded.value);
    }

    const estimatedRowCount = await this.estimateMaxRowCount(
      [...tableCache.values()],
      syncRowThreshold
    );
    const updatedTableIds = [...new Set(stages.map((stage) => stage.tableId))];

    if (!input.forceAsync && estimatedRowCount <= syncRowThreshold) {
      const notifyTargets = stages.reduce<FieldBackfillStageEntry[]>(
        (acc, stage) => mergeStageNotificationTargets(acc, stage),
        []
      );

      const txResult = await this.unitOfWork.withTransaction(context, async (txContext) => {
        for (const stage of stages) {
          const stageTable = tableCache.get(stage.tableId);
          if (!stageTable) continue;
          const stageFields = this.resolveStageFields(stageTable, stage.fieldIds);
          if (stageFields.length === 0) continue;

          const backfillResult = await this.backfillService.executeSyncMany(txContext, {
            table: stageTable,
            fields: stageFields,
          });
          if (backfillResult.isErr()) {
            return err(backfillResult.error);
          }
        }
        return ok(undefined);
      });
      if (txResult.isErr()) {
        return err(txResult.error);
      }

      await this.publishSetFieldTriggers(context, input.baseId, notifyTargets);
      return ok({
        mode: 'sync',
        stageCount: stages.length,
        estimatedRowCount,
        updatedTableIds,
      });
    }

    const [, ...remainingStages] = stages;
    const taskInput = buildFieldBackfillTaskInput({
      baseId: input.baseId,
      tableId: input.tableId,
      fieldIds: [input.fieldId],
      hasher: this.hasher,
      runId: generatePrefixedId('pfr', 16),
      estimatedRowCount,
      stageChain: {
        remainingStages,
        notifyTargets: [],
        ...(input.periodicRefreshMeta ? { periodicRefresh: input.periodicRefreshMeta } : {}),
      },
    });

    const enqueueResult = await this.outbox.enqueueFieldBackfill(taskInput, context);
    if (enqueueResult.isErr()) {
      return err(enqueueResult.error);
    }

    this.logger.info('computed:periodic_refresh:enqueued', {
      taskId: enqueueResult.value.taskId,
      baseId: input.baseId.toString(),
      tableId: input.tableId.toString(),
      fieldId: input.fieldId.toString(),
      stageCount: stages.length,
      estimatedRowCount,
    });

    return ok({
      mode: 'async',
      taskId: enqueueResult.value.taskId,
      stageCount: stages.length,
      estimatedRowCount,
      updatedTableIds,
    });
  }

  private resolveStageFields(table: Table, rawFieldIds: ReadonlyArray<string>): Field[] {
    const resolved: Field[] = [];
    for (const rawFieldId of rawFieldIds) {
      const fieldIdResult = FieldId.create(rawFieldId);
      if (fieldIdResult.isErr()) continue;
      const fieldResult = table.getField((field) => field.id().equals(fieldIdResult.value));
      if (fieldResult.isOk()) {
        resolved.push(fieldResult.value);
      }
    }
    return resolved;
  }

  private async publishSetFieldTriggers(
    context: IExecutionContext,
    baseId: BaseId,
    targets: ReadonlyArray<FieldBackfillStageEntry>
  ): Promise<void> {
    if (targets.length === 0) return;

    const events: TableActionTriggerRequested[] = [];
    for (const target of targets) {
      const tableIdResult = TableId.create(target.tableId);
      if (tableIdResult.isErr() || target.fieldIds.length === 0) continue;
      events.push(
        TableActionTriggerRequested.create({
          baseId,
          tableId: tableIdResult.value,
          actionKey: 'setField',
          payload: {
            tableId: target.tableId,
            fieldIds: target.fieldIds,
          },
        })
      );
    }
    if (events.length === 0) return;

    const publishResult = await this.eventBus.publishMany(withoutTransaction(context), events);
    if (publishResult.isErr()) {
      this.logger.warn('computed:periodic_refresh:trigger_publish_failed', {
        baseId: baseId.toString(),
        error: publishResult.error.message,
      });
    }
  }

  private async estimateMaxRowCount(
    tables: ReadonlyArray<Table>,
    syncRowThreshold: number
  ): Promise<number> {
    let maxRows = 0;
    const db = this.db as unknown as Kysely<DynamicDB>;

    for (const table of tables) {
      const locationResult = table
        .dbTableName()
        .andThen((dbTableName) => dbTableName.split({ defaultSchema: 'public' }));
      if (locationResult.isErr()) {
        return syncRowThreshold + 1;
      }
      const { schema, tableName } = locationResult.value;
      const schemaName = schema ?? 'public';

      try {
        const statsResult = await sql<{ estimated_row_count: number | string | null }>`
          SELECT GREATEST(c.reltuples, COALESCE(s.n_live_tup, 0), 0)::float8 AS estimated_row_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
          WHERE n.nspname = ${schemaName}
            AND c.relname = ${tableName}
          LIMIT 1
        `.execute(db);

        const rawEstimate = statsResult.rows[0]?.estimated_row_count;
        const estimate = rawEstimate == null ? 0 : Math.ceil(Number(rawEstimate));
        if (Number.isFinite(estimate) && estimate > syncRowThreshold) {
          maxRows = Math.max(maxRows, estimate);
          continue;
        }

        // Probe up to threshold + 1 rows so un-analyzed tables never take the wrong path.
        const fullName = sql.table(`${schemaName}.${tableName}`);
        const probeResult = await sql<{ bounded_count: number | string }>`
          SELECT COUNT(*)::int AS bounded_count
          FROM (
            SELECT 1 FROM ${fullName} LIMIT ${syncRowThreshold + 1}
          ) AS bounded_rows
        `.execute(db);
        const boundedCount = Number(probeResult.rows[0]?.bounded_count ?? 0);
        if (Number.isFinite(boundedCount)) {
          maxRows = Math.max(maxRows, boundedCount);
        }
      } catch (error) {
        this.logger.warn('computed:periodic_refresh:row_count_estimate_failed', {
          tableId: table.id().toString(),
          tableSchema: schemaName,
          tableName,
          error: error instanceof Error ? error.message : String(error),
        });
        return syncRowThreshold + 1;
      }
    }

    return maxRows;
  }
}
