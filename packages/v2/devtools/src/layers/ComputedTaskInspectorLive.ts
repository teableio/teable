import { ActorId, type IInternalCommandBus, v2CoreTokens } from '@teable/v2-core';
import {
  RunComputedTaskByIdCommand,
  type RunComputedTaskByIdResult,
  v2RecordRepositoryPostgresTokens,
} from '@teable/v2-adapter-table-repository-postgres';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Effect, Layer } from 'effect';
import type { Kysely, SelectQueryBuilder } from 'kysely';
import { sql } from 'kysely';
import { CliError } from '../errors/CliError';
import { Database } from '../services/Database';
import {
  ComputedTaskInspector,
  type CliTable,
  type ComputedQueueSummaryInput,
  type ComputedQueueSummaryOutput,
  type ComputedTaskDetailInput,
  type ComputedTaskDetailOutput,
  type ComputedTaskListInput,
  type ComputedTaskListOutput,
  type ComputedTaskRow,
  type ComputedTaskStatus,
  type ComputedTaskTableMatch,
  type QueueBaseRow,
  type QueueStatusRow,
  type QueueTableRow,
  type ReplayComputedQueueInput,
  type ReplayComputedQueueOutput,
  type TaskEdgeModeRow,
  type TaskTargetRow,
} from '../services/ComputedTaskInspector';

type RawTaskRow = {
  id: string;
  baseId: string;
  baseName: string;
  seedTableId: string;
  tableName: string;
  changeType: string;
  status: string;
  lockedBy: string | null;
  estimatedComplexity: number;
  runCompletedStepsBefore: number;
  runTotalSteps: number;
  updatedAt: Date;
  nextRunAt: Date;
  lastError: string | null;
  steps: unknown;
  edges: unknown;
  dirtyStats: unknown | null;
};

type EdgeDto = {
  propagationMode?: string;
  toTableId?: string;
};

const DEFAULT_STALE_HOURS = 1;
const DEFAULT_TOP = 20;
const DEFAULT_LIMIT = 100;

const parseDateInput = (value: string | undefined, field: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CliError({
      message: `Invalid ${field}: "${value}". Use ISO-8601 date/time text.`,
      code: 'INVALID_DATE',
      details: { field, value },
    });
  }
  return parsed;
};

const ensurePositive = (value: number | undefined, fallback: number, field: string): number => {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new CliError({
      message: `${field} must be a non-negative number.`,
      code: 'INVALID_NUMBER',
      details: { field, value: resolved },
    });
  }
  return Math.floor(resolved);
};

const ensureStatuses = (
  statuses: ReadonlyArray<ComputedTaskStatus> | undefined
): ReadonlyArray<ComputedTaskStatus> => {
  const resolved = statuses && statuses.length ? statuses : (['pending', 'processing'] as const);
  if ((resolved as ReadonlyArray<string>).includes('done')) {
    throw new CliError({
      message:
        'Successful computed tasks are deleted by markDone; current schema does not retain done history.',
      code: 'UNSUPPORTED_HISTORY',
      details: {
        requestedStatuses: resolved,
        hint: 'Use pending/processing for live backlog, or dead for failures.',
      },
    });
  }
  return resolved;
};

const normalizeTableMatch = (
  tableIds: ReadonlyArray<string> | undefined,
  tableMatch: ComputedTaskTableMatch | undefined
): ComputedTaskTableMatch | undefined => (tableIds?.length ? tableMatch ?? 'any' : undefined);

const toIso = (value: Date | null | undefined): string => (value ? value.toISOString() : '');

const parseJsonArray = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const parseEdges = (value: unknown): EdgeDto[] => parseJsonArray<EdgeDto>(value);

const matchesTableScope = (
  row: RawTaskRow,
  tableIds: ReadonlySet<string>,
  tableMatch: ComputedTaskTableMatch
): boolean => {
  const seedMatch = tableIds.has(row.seedTableId);
  if (tableMatch === 'seed') return seedMatch;

  const targetMatch = parseEdges(row.edges).some(
    (edge) => edge.toTableId != null && tableIds.has(edge.toTableId)
  );
  if (tableMatch === 'target') return targetMatch;

  return seedMatch || targetMatch;
};

const filterRowsByTableScope = (
  rows: ReadonlyArray<RawTaskRow>,
  tableIds: ReadonlyArray<string> | undefined,
  tableMatch: ComputedTaskTableMatch | undefined
): RawTaskRow[] => {
  if (!tableIds?.length) return [...rows];
  const normalizedMatch = tableMatch ?? 'any';
  const tableIdSet = new Set(tableIds);
  return rows.filter((row) => matchesTableScope(row, tableIdSet, normalizedMatch));
};

const tableScopeNotes = (
  tableIds: ReadonlyArray<string> | undefined,
  tableMatch: ComputedTaskTableMatch | undefined
): string[] =>
  tableIds?.length
    ? [
        `Table filtering is active with tableMatch=${tableMatch ?? 'any'} and matches direct seed/target tables only; transitive provenance is not reconstructed.`,
      ]
    : [];

const countDirtyStats = (value: unknown): number => parseJsonArray<unknown>(value).length;

const hasAllTargetRecords = (edges: ReadonlyArray<EdgeDto>): boolean =>
  edges.some((edge) => edge.propagationMode === 'allTargetRecords');

const staleCutoff = (staleHours: number): Date =>
  new Date(Date.now() - staleHours * 60 * 60 * 1000);

const isTaskStale = (
  row: RawTaskRow,
  staleHours: number,
  source: 'outbox' | 'dead-letter'
): boolean =>
  source === 'outbox' &&
  row.status === 'processing' &&
  row.updatedAt.getTime() < staleCutoff(staleHours).getTime();

const toTaskRow = (
  row: RawTaskRow,
  source: 'outbox' | 'dead-letter',
  staleHours: number
): ComputedTaskRow => {
  const edges = parseEdges(row.edges);
  return {
    id: row.id,
    source,
    status: row.status,
    baseId: row.baseId,
    baseName: row.baseName,
    seedTableId: row.seedTableId,
    tableName: row.tableName,
    changeType: row.changeType,
    lockedBy: row.lockedBy,
    estimatedComplexity: row.estimatedComplexity,
    runCompletedStepsBefore: row.runCompletedStepsBefore,
    runTotalSteps: row.runTotalSteps,
    stale: isTaskStale(row, staleHours, source),
    hasAllTargetRecords: hasAllTargetRecords(edges),
    edgeCount: edges.length,
    updatedAt: toIso(row.updatedAt),
    nextRunAt: toIso(row.nextRunAt),
    lastError: row.lastError,
  };
};

const makeTable = <Row>(
  columns: ReadonlyArray<keyof Row & string>,
  rows: ReadonlyArray<Row>
): CliTable<Row> => ({ columns, rows });

const applyTaskFilters = <DB, TB extends keyof DB & string>(
  query: SelectQueryBuilder<DB, TB, unknown>,
  alias: string,
  params: {
    baseIds?: ReadonlyArray<string>;
    statuses?: ReadonlyArray<string>;
    updatedFrom?: Date;
    updatedTo?: Date;
  }
) => {
  let next = query;
  if (params.baseIds?.length) {
    next = next.where(`${alias}.base_id` as never, 'in', [
      ...params.baseIds,
    ] as never) as typeof next;
  }
  if (params.statuses?.length) {
    next = next.where(`${alias}.status` as never, 'in', [
      ...params.statuses,
    ] as never) as typeof next;
  }
  if (params.updatedFrom) {
    next = next.where(
      `${alias}.updated_at` as never,
      '>=',
      params.updatedFrom as never
    ) as typeof next;
  }
  if (params.updatedTo) {
    next = next.where(
      `${alias}.updated_at` as never,
      '<=',
      params.updatedTo as never
    ) as typeof next;
  }
  return next;
};

const outboxBaseQuery = (db: Kysely<V1TeableDatabase>) =>
  db
    .selectFrom('computed_update_outbox as o')
    .leftJoin('base as b', 'b.id', 'o.base_id')
    .leftJoin('table_meta as tm', (join) =>
      join.onRef('tm.id', '=', 'o.seed_table_id').on('tm.deleted_time', 'is', null)
    )
    .select([
      'o.id as id',
      'o.base_id as baseId',
      sql<string>`coalesce(b.name, o.base_id)`.as('baseName'),
      'o.seed_table_id as seedTableId',
      sql<string>`coalesce(tm.name, o.seed_table_id)`.as('tableName'),
      'o.change_type as changeType',
      'o.status as status',
      'o.locked_by as lockedBy',
      'o.estimated_complexity as estimatedComplexity',
      'o.run_completed_steps_before as runCompletedStepsBefore',
      'o.run_total_steps as runTotalSteps',
      'o.updated_at as updatedAt',
      'o.next_run_at as nextRunAt',
      'o.last_error as lastError',
      'o.steps as steps',
      'o.edges as edges',
      'o.dirty_stats as dirtyStats',
    ]);

const deadLetterBaseQuery = (db: Kysely<V1TeableDatabase>) =>
  db
    .selectFrom('computed_update_dead_letter as o')
    .leftJoin('base as b', 'b.id', 'o.base_id')
    .leftJoin('table_meta as tm', (join) =>
      join.onRef('tm.id', '=', 'o.seed_table_id').on('tm.deleted_time', 'is', null)
    )
    .select([
      'o.id as id',
      'o.base_id as baseId',
      sql<string>`coalesce(b.name, o.base_id)`.as('baseName'),
      'o.seed_table_id as seedTableId',
      sql<string>`coalesce(tm.name, o.seed_table_id)`.as('tableName'),
      'o.change_type as changeType',
      'o.status as status',
      'o.locked_by as lockedBy',
      'o.estimated_complexity as estimatedComplexity',
      'o.run_completed_steps_before as runCompletedStepsBefore',
      'o.run_total_steps as runTotalSteps',
      'o.updated_at as updatedAt',
      'o.next_run_at as nextRunAt',
      'o.last_error as lastError',
      'o.steps as steps',
      'o.edges as edges',
      'o.dirty_stats as dirtyStats',
    ]);

const fetchOutboxRows = async (
  db: Kysely<V1TeableDatabase>,
  params: {
    baseIds?: ReadonlyArray<string>;
    statuses?: ReadonlyArray<'pending' | 'processing'>;
    updatedFrom?: Date;
    updatedTo?: Date;
  }
): Promise<RawTaskRow[]> => {
  const query = applyTaskFilters(outboxBaseQuery(db), 'o', params)
    .orderBy('o.updated_at', 'asc')
    .orderBy('o.id', 'asc');
  return (await query.execute()) as RawTaskRow[];
};

const fetchDeadLetterRows = async (
  db: Kysely<V1TeableDatabase>,
  params: {
    baseIds?: ReadonlyArray<string>;
    updatedFrom?: Date;
    updatedTo?: Date;
  }
): Promise<RawTaskRow[]> => {
  const query = applyTaskFilters(deadLetterBaseQuery(db), 'o', {
    ...params,
    statuses: ['dead'],
  })
    .orderBy('o.updated_at', 'asc')
    .orderBy('o.id', 'asc');
  return (await query.execute()) as RawTaskRow[];
};

const fetchTaskById = async (
  db: Kysely<V1TeableDatabase>,
  taskId: string,
  source: 'outbox' | 'dead-letter' | 'auto'
): Promise<{ source: 'outbox' | 'dead-letter'; row: RawTaskRow } | null> => {
  if (source !== 'dead-letter') {
    const outbox = await outboxBaseQuery(db).where('o.id', '=', taskId).executeTakeFirst();
    if (outbox) return { source: 'outbox', row: outbox as RawTaskRow };
  }
  if (source !== 'outbox') {
    const dead = await deadLetterBaseQuery(db).where('o.id', '=', taskId).executeTakeFirst();
    if (dead) return { source: 'dead-letter', row: dead as RawTaskRow };
  }
  return null;
};

const buildSummaryTables = (
  outboxRows: ReadonlyArray<RawTaskRow>,
  deadRows: ReadonlyArray<RawTaskRow>,
  staleHours: number,
  top: number
) => {
  const statusRows: QueueStatusRow[] = [];
  const baseMap = new Map<string, QueueBaseRow>();
  const tableMap = new Map<string, QueueTableRow>();

  let pending = 0;
  let processing = 0;
  let staleProcessing = 0;

  for (const row of outboxRows) {
    const isStale = isTaskStale(row, staleHours, 'outbox');
    if (row.status === 'pending') pending += 1;
    if (row.status === 'processing') {
      processing += 1;
      if (isStale) staleProcessing += 1;
    }

    const baseKey = row.baseId;
    const baseEntry = baseMap.get(baseKey) ?? {
      baseId: row.baseId,
      baseName: row.baseName,
      pending: 0,
      processing: 0,
      staleProcessing: 0,
      dead: 0,
      total: 0,
    };
    if (row.status === 'pending') baseEntry.pending += 1;
    if (row.status === 'processing') {
      baseEntry.processing += 1;
      if (isStale) baseEntry.staleProcessing += 1;
    }
    baseEntry.total += 1;
    baseMap.set(baseKey, baseEntry);

    const tableKey = `${row.baseId}:${row.seedTableId}`;
    const tableEntry = tableMap.get(tableKey) ?? {
      baseId: row.baseId,
      baseName: row.baseName,
      seedTableId: row.seedTableId,
      tableName: row.tableName,
      pending: 0,
      processing: 0,
      staleProcessing: 0,
      dead: 0,
      total: 0,
      maxEstimatedComplexity: 0,
    };
    if (row.status === 'pending') tableEntry.pending += 1;
    if (row.status === 'processing') {
      tableEntry.processing += 1;
      if (isStale) tableEntry.staleProcessing += 1;
    }
    tableEntry.total += 1;
    tableEntry.maxEstimatedComplexity = Math.max(
      tableEntry.maxEstimatedComplexity,
      row.estimatedComplexity
    );
    tableMap.set(tableKey, tableEntry);
  }

  for (const row of deadRows) {
    const baseKey = row.baseId;
    const baseEntry = baseMap.get(baseKey) ?? {
      baseId: row.baseId,
      baseName: row.baseName,
      pending: 0,
      processing: 0,
      staleProcessing: 0,
      dead: 0,
      total: 0,
    };
    baseEntry.dead += 1;
    baseEntry.total += 1;
    baseMap.set(baseKey, baseEntry);

    const tableKey = `${row.baseId}:${row.seedTableId}`;
    const tableEntry = tableMap.get(tableKey) ?? {
      baseId: row.baseId,
      baseName: row.baseName,
      seedTableId: row.seedTableId,
      tableName: row.tableName,
      pending: 0,
      processing: 0,
      staleProcessing: 0,
      dead: 0,
      total: 0,
      maxEstimatedComplexity: 0,
    };
    tableEntry.dead += 1;
    tableEntry.total += 1;
    tableEntry.maxEstimatedComplexity = Math.max(
      tableEntry.maxEstimatedComplexity,
      row.estimatedComplexity
    );
    tableMap.set(tableKey, tableEntry);
  }

  statusRows.push(
    { status: 'pending', freshness: 'fresh', count: pending },
    { status: 'processing', freshness: 'fresh', count: processing - staleProcessing },
    { status: 'processing', freshness: 'stale', count: staleProcessing },
    { status: 'dead', freshness: 'archived', count: deadRows.length }
  );

  const baseRows = [...baseMap.values()].sort(
    (a, b) => b.total - a.total || a.baseName.localeCompare(b.baseName)
  );
  const tableRows = [...tableMap.values()]
    .sort((a, b) => b.total - a.total || a.baseName.localeCompare(b.baseName))
    .slice(0, top);

  return {
    pending,
    processing,
    staleProcessing,
    statusTable: makeTable<QueueStatusRow>(['status', 'freshness', 'count'], statusRows),
    baseTable: makeTable<QueueBaseRow>(
      ['baseId', 'baseName', 'pending', 'processing', 'staleProcessing', 'dead', 'total'],
      baseRows
    ),
    tableTable: makeTable<QueueTableRow>(
      [
        'baseId',
        'baseName',
        'seedTableId',
        'tableName',
        'pending',
        'processing',
        'staleProcessing',
        'dead',
        'total',
        'maxEstimatedComplexity',
      ],
      tableRows
    ),
  };
};

const fetchTableNames = async (
  db: Kysely<V1TeableDatabase>,
  tableIds: ReadonlyArray<string>
): Promise<Map<string, string>> => {
  if (!tableIds.length) return new Map();
  const rows = await db
    .selectFrom('table_meta')
    .select(['id', 'name'])
    .where('id', 'in', [...new Set(tableIds)])
    .execute();
  return new Map(rows.map((row) => [row.id, row.name]));
};

const nextReplayTaskId = async (
  db: Kysely<V1TeableDatabase>,
  baseIds?: ReadonlyArray<string>
): Promise<string | undefined> => {
  let query = db
    .selectFrom('computed_update_outbox as o')
    .select('o.id as id')
    .where('o.status', 'in', ['pending', 'processing'])
    .orderBy('o.next_run_at', 'asc')
    .orderBy('o.updated_at', 'asc')
    .orderBy('o.id', 'asc')
    .limit(1);

  if (baseIds?.length) {
    query = query.where('o.base_id', 'in', baseIds);
  }

  return (await query.executeTakeFirst())?.id;
};

const fetchRemainingByBase = async (
  db: Kysely<V1TeableDatabase>,
  baseIds?: ReadonlyArray<string>
) => {
  let query = db
    .selectFrom('computed_update_outbox as o')
    .leftJoin('base as b', 'b.id', 'o.base_id')
    .select([
      'o.base_id as baseId',
      sql<string>`coalesce(b.name, o.base_id)`.as('baseName'),
      sql<number>`count(*)`.as('remaining'),
    ])
    .where('o.status', 'in', ['pending', 'processing'])
    .groupBy(['o.base_id', 'b.name'])
    .orderBy(sql<number>`count(*)`, 'desc')
    .orderBy('o.base_id', 'asc');

  if (baseIds?.length) {
    query = query.where('o.base_id', 'in', baseIds);
  }

  return query.execute();
};

const createContext = () => {
  const actorIdResult = ActorId.create('cli-computed-task');
  if (actorIdResult.isErr()) {
    throw CliError.fromUnknown(actorIdResult.error);
  }
  return { actorId: actorIdResult.value };
};

export const ComputedTaskInspectorLive = Layer.effect(
  ComputedTaskInspector,
  Effect.gen(function* () {
    const { container } = yield* Database;
    const db = container.resolve(v2RecordRepositoryPostgresTokens.db) as Kysely<V1TeableDatabase>;
    const internalCommandBus = container.resolve(
      v2CoreTokens.internalCommandBus
    ) as IInternalCommandBus;

    return {
      getQueueSummary: (
        input: ComputedQueueSummaryInput
      ): Effect.Effect<ComputedQueueSummaryOutput, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const staleHours = ensurePositive(input.staleHours, DEFAULT_STALE_HOURS, 'staleHours');
            const top = ensurePositive(input.top, DEFAULT_TOP, 'top');
            const tableMatch = normalizeTableMatch(input.tableIds, input.tableMatch);
            const [outboxRows, deadRows] = await Promise.all([
              fetchOutboxRows(db, { baseIds: input.baseIds, statuses: ['pending', 'processing'] }),
              fetchDeadLetterRows(db, { baseIds: input.baseIds }),
            ]);
            const filteredOutboxRows = filterRowsByTableScope(
              outboxRows,
              input.tableIds,
              tableMatch
            );
            const filteredDeadRows = filterRowsByTableScope(deadRows, input.tableIds, tableMatch);

            const tables = buildSummaryTables(
              filteredOutboxRows,
              filteredDeadRows,
              staleHours,
              top
            );

            return {
              snapshotAt: new Date().toISOString(),
              scope: {
                ...(input.baseIds?.length ? { baseIds: input.baseIds } : {}),
                ...(input.tableIds?.length
                  ? { tableIds: input.tableIds, ...(tableMatch ? { tableMatch } : {}) }
                  : {}),
                staleHours,
              },
              totals: {
                remaining: filteredOutboxRows.length,
                pending: tables.pending,
                processing: tables.processing,
                staleProcessing: tables.staleProcessing,
                dead: filteredDeadRows.length,
              },
              statusTable: tables.statusTable,
              baseTable: tables.baseTable,
              tableTable: tables.tableTable,
              notes: [
                'Successful computed tasks are deleted on completion, so current summary covers live backlog and archived dead-letter only.',
                ...tableScopeNotes(input.tableIds, tableMatch),
              ],
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),

      listTasks: (input: ComputedTaskListInput): Effect.Effect<ComputedTaskListOutput, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const statuses = ensureStatuses(input.statuses);
            const staleHours = ensurePositive(input.staleHours, DEFAULT_STALE_HOURS, 'staleHours');
            const limit = ensurePositive(input.limit, DEFAULT_LIMIT, 'limit');
            const offset = ensurePositive(input.offset, 0, 'offset');
            const updatedFrom = parseDateInput(input.updatedFrom, 'updatedFrom');
            const updatedTo = parseDateInput(input.updatedTo, 'updatedTo');
            const tableMatch = normalizeTableMatch(input.tableIds, input.tableMatch);

            const includeOutbox = statuses.some((status) => status !== 'dead');
            const includeDead = statuses.includes('dead');

            const [outboxRows, deadRows] = await Promise.all([
              includeOutbox
                ? fetchOutboxRows(db, {
                    baseIds: input.baseIds,
                    statuses: statuses.filter(
                      (status): status is 'pending' | 'processing' => status !== 'dead'
                    ),
                    updatedFrom,
                    updatedTo,
                  })
                : Promise.resolve([]),
              includeDead
                ? fetchDeadLetterRows(db, { baseIds: input.baseIds, updatedFrom, updatedTo })
                : Promise.resolve([]),
            ]);
            const filteredOutboxRows = filterRowsByTableScope(
              outboxRows,
              input.tableIds,
              tableMatch
            );
            const filteredDeadRows = filterRowsByTableScope(deadRows, input.tableIds, tableMatch);

            const rows = [
              ...filteredOutboxRows.map((row) => toTaskRow(row, 'outbox', staleHours)),
              ...filteredDeadRows.map((row) => toTaskRow(row, 'dead-letter', staleHours)),
            ].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));

            const paged = rows.slice(offset, offset + limit);

            return {
              snapshotAt: new Date().toISOString(),
              scope: {
                ...(input.baseIds?.length ? { baseIds: input.baseIds } : {}),
                ...(input.tableIds?.length
                  ? { tableIds: input.tableIds, ...(tableMatch ? { tableMatch } : {}) }
                  : {}),
                statuses,
                staleHours,
                limit,
                offset,
                ...(input.updatedFrom ? { updatedFrom: input.updatedFrom } : {}),
                ...(input.updatedTo ? { updatedTo: input.updatedTo } : {}),
              },
              total: rows.length,
              taskTable: makeTable<ComputedTaskRow>(
                [
                  'id',
                  'source',
                  'status',
                  'baseId',
                  'baseName',
                  'seedTableId',
                  'tableName',
                  'changeType',
                  'lockedBy',
                  'estimatedComplexity',
                  'runCompletedStepsBefore',
                  'runTotalSteps',
                  'stale',
                  'hasAllTargetRecords',
                  'edgeCount',
                  'updatedAt',
                  'nextRunAt',
                  'lastError',
                ],
                paged
              ),
              historyAvailable: false,
              notes: [
                'Successful computed tasks are deleted by markDone and are not queryable from current schema.',
                ...tableScopeNotes(input.tableIds, tableMatch),
              ],
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),

      getTaskDetail: (
        input: ComputedTaskDetailInput
      ): Effect.Effect<ComputedTaskDetailOutput, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const staleHours = ensurePositive(input.staleHours, DEFAULT_STALE_HOURS, 'staleHours');
            const source = input.source ?? 'auto';
            const found = await fetchTaskById(db, input.taskId, source);
            if (!found) {
              throw new CliError({
                message: `Computed task not found: ${input.taskId}`,
                code: 'NOT_FOUND',
                details: { taskId: input.taskId, source },
              });
            }

            const task = toTaskRow(found.row, found.source, staleHours);
            const edges = parseEdges(found.row.edges);
            const edgeModeCounts = new Map<string, number>();
            const targetCounts = new Map<string, number>();

            for (const edge of edges) {
              const mode = edge.propagationMode ?? 'linkTraversal';
              edgeModeCounts.set(mode, (edgeModeCounts.get(mode) ?? 0) + 1);
              const targetId = edge.toTableId ?? '-';
              targetCounts.set(targetId, (targetCounts.get(targetId) ?? 0) + 1);
            }

            const tableNames = await fetchTableNames(
              db,
              [...targetCounts.keys()].filter((id) => id !== '-')
            );

            const edgeModeTable = makeTable<TaskEdgeModeRow>(
              ['mode', 'count'],
              [...edgeModeCounts.entries()]
                .map(([mode, count]) => ({ mode, count }))
                .sort((a, b) => b.count - a.count || a.mode.localeCompare(b.mode))
            );

            const targetTable = makeTable<TaskTargetRow>(
              ['targetTableId', 'targetTableName', 'edgeCount'],
              [...targetCounts.entries()]
                .map(([targetTableId, edgeCount]) => ({
                  targetTableId,
                  targetTableName:
                    targetTableId === '-' ? '-' : tableNames.get(targetTableId) ?? targetTableId,
                  edgeCount,
                }))
                .sort(
                  (a, b) =>
                    b.edgeCount - a.edgeCount || a.targetTableName.localeCompare(b.targetTableName)
                )
            );

            const allTargetRecordsCount = edges.filter(
              (edge) => edge.propagationMode === 'allTargetRecords'
            ).length;

            return {
              snapshotAt: new Date().toISOString(),
              task,
              summary: {
                stepCount: parseJsonArray<unknown>(found.row.steps).length,
                edgeCount: edges.length,
                allTargetRecordsCount,
                dirtyStatCount: countDirtyStats(found.row.dirtyStats),
              },
              edgeModeTable,
              targetTable,
              notes: [
                allTargetRecordsCount > 0
                  ? 'This task includes allTargetRecords propagation, which usually dominates fan-out cost.'
                  : 'This task does not include allTargetRecords propagation.',
              ],
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),

      replayQueue: (
        input: ReplayComputedQueueInput
      ): Effect.Effect<ReplayComputedQueueOutput, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const limit = input.limit == null ? null : ensurePositive(input.limit, 0, 'limit');
            const top = ensurePositive(input.top, DEFAULT_TOP, 'top');

            const initialRemaining = Number(
              (
                await db
                  .selectFrom('computed_update_outbox as o')
                  .select(sql<number>`count(*)`.as('count'))
                  .where('o.status', 'in', ['pending', 'processing'])
                  .$if(Boolean(input.baseIds?.length), (qb) =>
                    qb.where('o.base_id', 'in', input.baseIds ?? [])
                  )
                  .executeTakeFirstOrThrow()
              ).count
            );

            let processed = 0;
            const start = Date.now();
            const context = createContext();

            while (true) {
              if (limit !== null && processed >= limit) break;

              const taskId = await nextReplayTaskId(db, input.baseIds);
              if (!taskId) break;

              const commandResult = RunComputedTaskByIdCommand.create({
                taskId,
                workerId: input.workerId,
              });
              if (commandResult.isErr()) {
                throw CliError.fromUnknown(commandResult.error);
              }

              try {
                const executeResult = await internalCommandBus.execute<
                  RunComputedTaskByIdCommand,
                  RunComputedTaskByIdResult
                >(context, commandResult.value);
                if (executeResult.isErr()) throw executeResult.error;
                processed += 1;
              } catch (error) {
                const cliError = CliError.fromUnknown(error);
                if (cliError.code === 'computed_task.not_retryable') {
                  continue;
                }
                throw cliError;
              }
            }

            const remainingRows = await fetchRemainingByBase(db, input.baseIds);
            const finalRemaining = remainingRows.reduce(
              (sum, row) => sum + Number(row.remaining ?? 0),
              0
            );

            return {
              scope: {
                ...(input.baseIds?.length ? { baseIds: input.baseIds } : {}),
                workerId: input.workerId,
                limit,
              },
              processed,
              initialRemaining,
              finalRemaining,
              elapsedMs: Date.now() - start,
              remainingByBaseTable: makeTable(
                ['baseId', 'baseName', 'remaining'],
                remainingRows
                  .map((row) => ({
                    baseId: row.baseId,
                    baseName: row.baseName,
                    remaining: Number(row.remaining ?? 0),
                  }))
                  .slice(0, top)
              ),
            };
          },
          catch: (error) => CliError.fromUnknown(error),
        }),
    };
  })
);
