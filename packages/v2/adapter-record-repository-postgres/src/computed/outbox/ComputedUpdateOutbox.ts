import {
  domainError,
  type DomainError,
  type IExecutionContext,
  type ILogger,
  v2CoreTokens,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely, Transaction } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { DynamicDB } from '../../query-builder';
import type { DirtyRecordStats } from '../ComputedFieldUpdater';
import type {
  ComputedUpdateOutboxItem,
  ComputedUpdateOutboxTaskInput,
} from './ComputedUpdateOutboxPayload';
import { defaultComputedUpdateOutboxConfig } from './IComputedUpdateOutbox';
import type {
  IComputedUpdateOutbox,
  ClaimBatchParams,
  ComputedUpdateOutboxConfig,
} from './IComputedUpdateOutbox';

const OUTBOX_TABLE = 'computed_update_outbox';
const OUTBOX_SEED_TABLE = 'computed_update_outbox_seed';
const DEAD_LETTER_TABLE = 'computed_update_dead_letter';

const DEFAULT_STATUS = 'pending';

type OutboxRow = Record<string, unknown>;

type SeedRecord = {
  tableId: string;
  recordId: string;
};

type SeedGroup = {
  tableId: string;
  recordIds: string[];
};

type SeedRow = {
  task_id: string;
  table_id: string;
  record_id: string;
};

/**
 * Persist computed update tasks for background processing (outbox pattern).
 *
 * Example
 * ```typescript
 * const result = await outbox.enqueueOrMerge(task, context);
 * if (result.isOk()) {
 *   const claimed = await outbox.claimBatch({ workerId: 'worker-1', limit: 10 });
 * }
 * ```
 */
@injectable()
export class ComputedUpdateOutbox implements IComputedUpdateOutbox {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig)
    private readonly config: ComputedUpdateOutboxConfig = defaultComputedUpdateOutboxConfig,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
  ) {}

  async enqueueOrMerge(
    task: ComputedUpdateOutboxTaskInput,
    context?: IExecutionContext
  ): Promise<Result<{ taskId: string; merged: boolean }, DomainError>> {
    const now = new Date();
    const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

    return runInTransaction<{ taskId: string; merged: boolean }>(db, context, async (trx) => {
      const existing = await trx
        .selectFrom(OUTBOX_TABLE)
        .selectAll()
        .where('base_id', '=', task.baseId)
        .where('seed_table_id', '=', task.seedTableId)
        .where('plan_hash', '=', task.planHash)
        .where('change_type', '=', task.changeType)
        .where('status', '=', DEFAULT_STATUS)
        .forUpdate()
        .executeTakeFirst();

      if (!existing) {
        const taskId = await this.insertOutbox(trx, task, now);
        return ok({ taskId, merged: false });
      }

      const taskId = String(existing.id);
      const incomingSeedGroups = buildSeedGroupsFromTask(task);
      const existingSeedGroups = await this.loadSeedGroups(trx, existing);
      const mergedSeedGroups = mergeSeedGroups(existingSeedGroups, incomingSeedGroups);
      const mergedDirtyStats = mergeDirtyStats(
        parseDirtyStats(existing.dirty_stats),
        task.dirtyStats
      );

      const seedInlineLimit = this.config.seedInlineLimit;
      const mergedSeedCount = countSeedRecords(mergedSeedGroups);
      const useSeedTable = mergedSeedCount > seedInlineLimit;

      if (useSeedTable) {
        await this.upsertSeedRows(trx, taskId, flattenSeedGroups(mergedSeedGroups));
      } else {
        await trx.deleteFrom(OUTBOX_SEED_TABLE).where('task_id', '=', taskId).execute();
      }

      await trx
        .updateTable(OUTBOX_TABLE)
        .set({
          seed_record_ids: useSeedTable ? null : mergedSeedGroups,
          dirty_stats: mergedDirtyStats,
          estimated_complexity: Math.max(
            Number(existing.estimated_complexity ?? 0),
            task.estimatedComplexity
          ),
          sync_max_level: Math.max(Number(existing.sync_max_level ?? 0), task.syncMaxLevel),
          next_run_at: now,
          updated_at: now,
        })
        .where('id', '=', taskId)
        .execute();

      this.logger.debug('computed:outbox:merged', {
        taskId,
        seedCount: mergedSeedCount,
      });

      return ok({ taskId, merged: true });
    });
  }

  async claimBatch(
    params: ClaimBatchParams,
    context?: IExecutionContext
  ): Promise<Result<ReadonlyArray<ComputedUpdateOutboxItem>, DomainError>> {
    const now = params.now ?? new Date();
    const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

    return runInTransaction(db, context, async (trx) => {
      const rows = await trx
        .selectFrom(OUTBOX_TABLE)
        .selectAll()
        .where('status', '=', DEFAULT_STATUS)
        .where('next_run_at', '<=', now)
        .orderBy('created_at', 'asc')
        .limit(params.limit)
        .forUpdate()
        .skipLocked()
        .execute();

      if (rows.length === 0) return ok([]);

      const ids = rows.map((row) => String(row.id));
      await trx
        .updateTable(OUTBOX_TABLE)
        .set({
          status: 'processing',
          locked_at: now,
          locked_by: params.workerId,
          updated_at: now,
        })
        .where('id', 'in', ids)
        .execute();

      const seedMap = await this.loadSeedRecords(trx, rows);
      const tasks = rows.map((row) => toOutboxItem(row, seedMap.get(String(row.id)) ?? []));

      return ok(tasks);
    });
  }

  async markDone(taskId: string, context?: IExecutionContext): Promise<Result<void, DomainError>> {
    const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
    return runInTransaction(db, context, async (trx) => {
      await trx.deleteFrom(OUTBOX_TABLE).where('id', '=', taskId).execute();
      await trx.deleteFrom(OUTBOX_SEED_TABLE).where('task_id', '=', taskId).execute();
      return ok(undefined);
    });
  }

  async markFailed(
    task: ComputedUpdateOutboxItem,
    error: string,
    context?: IExecutionContext
  ): Promise<Result<void, DomainError>> {
    const now = new Date();
    const db = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;
    const nextAttempts = task.attempts + 1;

    return runInTransaction(db, context, async (trx) => {
      if (nextAttempts >= task.maxAttempts) {
        await trx
          .insertInto(DEAD_LETTER_TABLE)
          .values({
            id: task.id,
            base_id: task.baseId,
            seed_table_id: task.seedTableId,
            seed_record_ids: buildSeedGroupsFromTask(task),
            change_type: task.changeType,
            steps: task.steps,
            edges: task.edges,
            status: 'dead',
            attempts: nextAttempts,
            max_attempts: task.maxAttempts,
            next_run_at: task.nextRunAt,
            locked_at: task.lockedAt ?? null,
            locked_by: task.lockedBy ?? null,
            last_error: error,
            estimated_complexity: task.estimatedComplexity,
            plan_hash: task.planHash,
            dirty_stats: task.dirtyStats ?? null,
            affected_table_ids: task.affectedTableIds,
            affected_field_ids: task.affectedFieldIds,
            sync_max_level: task.syncMaxLevel,
            failed_at: now,
            created_at: task.createdAt,
            updated_at: now,
          })
          .execute();

        await trx.deleteFrom(OUTBOX_TABLE).where('id', '=', task.id).execute();
        await trx.deleteFrom(OUTBOX_SEED_TABLE).where('task_id', '=', task.id).execute();

        this.logger.warn('computed:outbox:dead_letter', { taskId: task.id, error });
        return ok(undefined);
      }

      const delay = Math.min(
        this.config.baseBackoffMs * 2 ** (nextAttempts - 1),
        this.config.maxBackoffMs
      );
      const nextRunAt = new Date(now.getTime() + delay);

      await trx
        .updateTable(OUTBOX_TABLE)
        .set({
          status: DEFAULT_STATUS,
          attempts: nextAttempts,
          next_run_at: nextRunAt,
          last_error: error,
          locked_at: null,
          locked_by: null,
          updated_at: now,
        })
        .where('id', '=', task.id)
        .execute();

      this.logger.warn('computed:outbox:retry_scheduled', {
        taskId: task.id,
        attempts: nextAttempts,
        nextRunAt,
      });

      return ok(undefined);
    });
  }

  private async insertOutbox(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    task: ComputedUpdateOutboxTaskInput,
    now: Date
  ): Promise<string> {
    const seedGroups = buildSeedGroupsFromTask(task);
    const seedCount = countSeedRecords(seedGroups);
    const useSeedTable = seedCount > this.config.seedInlineLimit;

    const record = await trx
      .insertInto(OUTBOX_TABLE)
      .values({
        base_id: task.baseId,
        seed_table_id: task.seedTableId,
        seed_record_ids: useSeedTable ? null : seedGroups,
        change_type: task.changeType,
        steps: task.steps,
        edges: task.edges,
        status: DEFAULT_STATUS,
        attempts: 0,
        max_attempts: this.config.maxAttempts,
        next_run_at: now,
        locked_at: null,
        locked_by: null,
        last_error: null,
        estimated_complexity: task.estimatedComplexity,
        plan_hash: task.planHash,
        dirty_stats: task.dirtyStats ?? null,
        affected_table_ids: task.affectedTableIds,
        affected_field_ids: task.affectedFieldIds,
        sync_max_level: task.syncMaxLevel,
        created_at: now,
        updated_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const taskId = String(record.id);

    if (useSeedTable) {
      await this.upsertSeedRows(trx, taskId, flattenSeedGroups(seedGroups));
    }

    return taskId;
  }

  private async loadSeedGroups(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    existing: OutboxRow
  ): Promise<SeedGroup[]> {
    const inlineGroups = parseSeedGroups(existing.seed_record_ids, String(existing.seed_table_id));

    if (existing.seed_record_ids !== null) return inlineGroups;

    const storedGroups = await this.loadSeedRecordsForTask(trx, String(existing.id));
    return mergeSeedGroups(inlineGroups, storedGroups);
  }

  private async loadSeedRecords(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    rows: OutboxRow[]
  ): Promise<Map<string, SeedGroup[]>> {
    const needsSeed = rows
      .filter((row) => row.seed_record_ids === null)
      .map((row) => String(row.id));

    if (needsSeed.length === 0) return new Map();

    const seedRows = await trx
      .selectFrom(OUTBOX_SEED_TABLE)
      .select(['task_id', 'table_id', 'record_id'])
      .where('task_id', 'in', needsSeed)
      .execute();

    const map = new Map<string, SeedGroup[]>();
    for (const row of seedRows as SeedRow[]) {
      const groups = map.get(row.task_id) ?? [];
      map.set(row.task_id, groups);
      const group = groups.find((entry) => entry.tableId === row.table_id);
      if (group) {
        group.recordIds.push(row.record_id);
      } else {
        groups.push({ tableId: row.table_id, recordIds: [row.record_id] });
      }
    }
    return map;
  }

  private async loadSeedRecordsForTask(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    taskId: string
  ): Promise<SeedGroup[]> {
    const seedRows = await trx
      .selectFrom(OUTBOX_SEED_TABLE)
      .select(['task_id', 'table_id', 'record_id'])
      .where('task_id', '=', taskId)
      .execute();

    const groups: SeedGroup[] = [];
    for (const row of seedRows as SeedRow[]) {
      const group = groups.find((entry) => entry.tableId === row.table_id);
      if (group) {
        group.recordIds.push(row.record_id);
      } else {
        groups.push({ tableId: row.table_id, recordIds: [row.record_id] });
      }
    }
    return groups;
  }

  private async upsertSeedRows(
    trx: Kysely<DynamicDB> | Transaction<DynamicDB>,
    taskId: string,
    seeds: SeedRecord[]
  ): Promise<void> {
    if (seeds.length === 0) return;

    const rows = seeds.map((record) => ({
      task_id: taskId,
      table_id: record.tableId,
      record_id: record.recordId,
    }));

    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      await trx
        .insertInto(OUTBOX_SEED_TABLE)
        .values(rows.slice(i, i + batchSize))
        .onConflict((oc) => oc.columns(['task_id', 'table_id', 'record_id']).doNothing())
        .execute();
    }
  }
}

const toOutboxItem = (
  row: OutboxRow,
  seedGroupsFromTable: SeedGroup[]
): ComputedUpdateOutboxItem => {
  const seedTableId = String(row.seed_table_id);
  const inlineSeedGroups = parseSeedGroups(row.seed_record_ids, seedTableId);
  const seedGroups = mergeSeedGroups(inlineSeedGroups, seedGroupsFromTable);
  const { seedRecordIds, extraSeedRecords } = splitSeedGroups(seedTableId, seedGroups);

  return {
    id: String(row.id),
    baseId: String(row.base_id),
    seedTableId,
    seedRecordIds,
    extraSeedRecords,
    steps: parseJsonArray(row.steps) ?? [],
    edges: parseJsonArray(row.edges) ?? [],
    estimatedComplexity: Number(row.estimated_complexity ?? 0),
    changeType: String(row.change_type) as ComputedUpdateOutboxItem['changeType'],
    planHash: String(row.plan_hash),
    dirtyStats: parseDirtyStats(row.dirty_stats),
    affectedTableIds: parseStringArray(row.affected_table_ids),
    affectedFieldIds: parseStringArray(row.affected_field_ids),
    syncMaxLevel: Number(row.sync_max_level ?? 0),
    status: String(row.status) as ComputedUpdateOutboxItem['status'],
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    nextRunAt: new Date(String(row.next_run_at)),
    lockedAt: row.locked_at ? new Date(String(row.locked_at)) : null,
    lockedBy: row.locked_by ? String(row.locked_by) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
};

const parseJsonArray = <T>(value: unknown): T[] | undefined => {
  if (Array.isArray(value)) return value as T[];
  return undefined;
};

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [];
};

const parseDirtyStats = (value: unknown): ReadonlyArray<DirtyRecordStats> | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as { tableId?: unknown; recordCount?: unknown };
      if (typeof entry.tableId !== 'string') return null;
      return {
        tableId: entry.tableId,
        recordCount: Number(entry.recordCount ?? 0),
      };
    })
    .filter((item): item is DirtyRecordStats => item !== null);
};

const parseSeedGroups = (value: unknown, seedTableId: string): SeedGroup[] => {
  if (!Array.isArray(value)) return [];

  const groups = new Map<string, Set<string>>();

  for (const item of value) {
    if (typeof item === 'string') {
      const set = groups.get(seedTableId) ?? new Set<string>();
      set.add(item);
      groups.set(seedTableId, set);
      continue;
    }

    if (!item || typeof item !== 'object') continue;

    const recordId = (item as { recordId?: unknown }).recordId;
    const recordIds = (item as { recordIds?: unknown }).recordIds;
    const tableId = String((item as { tableId?: unknown }).tableId ?? seedTableId);

    if (Array.isArray(recordIds)) {
      const set = groups.get(tableId) ?? new Set<string>();
      for (const id of recordIds) {
        set.add(String(id));
      }
      groups.set(tableId, set);
      continue;
    }

    if (recordId !== undefined && recordId !== null) {
      const set = groups.get(tableId) ?? new Set<string>();
      set.add(String(recordId));
      groups.set(tableId, set);
    }
  }

  return [...groups.entries()].map(([tableId, recordIds]) => ({
    tableId,
    recordIds: [...recordIds],
  }));
};

const mergeSeedGroups = (...groups: SeedGroup[][]): SeedGroup[] => {
  const merged = new Map<string, Set<string>>();

  for (const groupList of groups) {
    for (const group of groupList) {
      if (!group || group.recordIds.length === 0) continue;
      const set = merged.get(group.tableId) ?? new Set<string>();
      for (const recordId of group.recordIds) {
        set.add(recordId);
      }
      merged.set(group.tableId, set);
    }
  }

  return [...merged.entries()].map(([tableId, recordIds]) => ({
    tableId,
    recordIds: [...recordIds],
  }));
};

const splitSeedGroups = (
  seedTableId: string,
  groups: SeedGroup[]
): { seedRecordIds: string[]; extraSeedRecords: SeedGroup[] } => {
  const seedRecordIds: string[] = [];
  const extraSeedRecords: SeedGroup[] = [];

  for (const group of groups) {
    if (group.tableId === seedTableId) {
      seedRecordIds.push(...group.recordIds);
    } else {
      extraSeedRecords.push(group);
    }
  }

  return { seedRecordIds, extraSeedRecords };
};

const buildSeedGroupsFromTask = (task: ComputedUpdateOutboxTaskInput): SeedGroup[] => {
  const baseGroup: SeedGroup = {
    tableId: task.seedTableId,
    recordIds: task.seedRecordIds,
  };

  return mergeSeedGroups([baseGroup], task.extraSeedRecords ?? []);
};

const flattenSeedGroups = (groups: SeedGroup[]): SeedRecord[] => {
  const seeds: SeedRecord[] = [];
  for (const group of groups) {
    for (const recordId of group.recordIds) {
      seeds.push({ tableId: group.tableId, recordId });
    }
  }
  return seeds;
};

const countSeedRecords = (groups: SeedGroup[]): number => {
  return groups.reduce((sum, group) => sum + group.recordIds.length, 0);
};

const mergeDirtyStats = (
  existing: ReadonlyArray<DirtyRecordStats> | undefined,
  incoming: ReadonlyArray<DirtyRecordStats> | undefined
): ReadonlyArray<DirtyRecordStats> | undefined => {
  if (!existing && !incoming) return undefined;
  const map = new Map<string, number>();
  for (const stat of existing ?? []) {
    map.set(stat.tableId, (map.get(stat.tableId) ?? 0) + stat.recordCount);
  }
  for (const stat of incoming ?? []) {
    map.set(stat.tableId, (map.get(stat.tableId) ?? 0) + stat.recordCount);
  }
  return [...map.entries()].map(([tableId, recordCount]) => ({ tableId, recordCount }));
};

interface PostgresTransactionContext<DB> {
  kind: 'unitOfWorkTransaction';
  db: Transaction<DB>;
}

const getPostgresTransaction = <DB>(context?: IExecutionContext): Transaction<DB> | null => {
  const transaction = context?.transaction as Partial<PostgresTransactionContext<DB>> | undefined;
  if (transaction?.kind === 'unitOfWorkTransaction' && transaction.db) {
    return transaction.db as Transaction<DB>;
  }
  return null;
};

const resolvePostgresDb = <DB>(
  db: Kysely<DB>,
  context?: IExecutionContext
): Kysely<DB> | Transaction<DB> => {
  return getPostgresTransaction<DB>(context) ?? db;
};

const runInTransaction = async <T>(
  db: Kysely<DynamicDB>,
  context: IExecutionContext | undefined,
  fn: (trx: Kysely<DynamicDB> | Transaction<DynamicDB>) => Promise<Result<T, DomainError>>
): Promise<Result<T, DomainError>> => {
  const hasTransaction = Boolean(getPostgresTransaction(context));

  try {
    if (hasTransaction) {
      return await fn(db as Transaction<DynamicDB>);
    }

    return await db.transaction().execute(async (trx) => fn(trx));
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Outbox transaction failed: ${describeError(error)}`,
      })
    );
  }
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};
