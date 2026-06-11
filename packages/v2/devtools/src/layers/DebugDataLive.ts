import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { splitSchemaQualifiedTableName } from '@teable/v2-adapter-table-repository-postgres';
import {
  v2CoreTokens,
  TableId,
  RecordId,
  TableByIdSpec,
  PageLimit,
  PageOffset,
  OffsetPagination,
  ActorId,
  type ITableRepository,
  type ITableRecordQueryRepository,
} from '@teable/v2-core';
import {
  registerV2DebugData,
  v2DebugDataTokens,
  type DebugDataService,
  type DebugTableMeta,
  type DebugTableSummary,
  type DebugFieldMeta,
  type DebugFieldRelationReport,
} from '@teable/v2-debug-data';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Effect, Layer } from 'effect';
import { sql, type Kysely } from 'kysely';
import { CliError } from '../errors/CliError';
import { Database } from '../services/Database';
import {
  type CanarySpaceCheckResult,
  DebugData,
  type UndoCaptureInspectionResult,
  type RecordQueryOptions,
  type RecordQueryResult,
  type RecordReadModel,
  type RawRecordQueryOptions,
  type RawRecordQueryResult,
  type RawRecord,
} from '../services/DebugData';

type ParsedCanaryConfig = {
  present: boolean;
  valid: boolean;
  enabled: boolean;
  forceV2All: boolean;
  spaceIds: string[];
};

const toIso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

const parseCanaryConfig = (content: string | null | undefined): ParsedCanaryConfig => {
  if (content == null) {
    return {
      present: false,
      valid: false,
      enabled: false,
      forceV2All: false,
      spaceIds: [],
    };
  }

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : false;
    const forceV2All = typeof parsed.forceV2All === 'boolean' ? parsed.forceV2All : false;
    const spaceIds = Array.isArray(parsed.spaceIds)
      ? parsed.spaceIds.filter((value): value is string => typeof value === 'string')
      : [];
    const valid =
      typeof parsed === 'object' &&
      parsed != null &&
      typeof parsed.enabled === 'boolean' &&
      Array.isArray(parsed.spaceIds);

    return {
      present: true,
      valid,
      enabled,
      forceV2All,
      spaceIds,
    };
  } catch {
    return {
      present: true,
      valid: false,
      enabled: false,
      forceV2All: false,
      spaceIds: [],
    };
  }
};

const resolveCanaryMembership = (
  env: { enableCanaryFeature: boolean; forceV2All: boolean },
  config: ParsedCanaryConfig,
  spaceId: string
): Omit<CanarySpaceCheckResult, 'target'> => {
  const matched = config.valid ? config.spaceIds.includes(spaceId) : false;

  const canaryReason: CanarySpaceCheckResult['canaryReason'] = !env.enableCanaryFeature
    ? 'env_disabled'
    : !config.present
      ? 'config_missing'
      : !config.valid
        ? 'config_invalid'
        : !config.enabled
          ? 'config_disabled'
          : matched
            ? 'space_list'
            : 'space_not_listed';

  const effectiveUseV2Reason: CanarySpaceCheckResult['effectiveUseV2Reason'] = env.forceV2All
    ? 'env_force_v2_all'
    : !env.enableCanaryFeature
      ? 'env_disabled'
      : !config.present
        ? 'config_missing'
        : !config.valid
          ? 'config_invalid'
          : config.forceV2All
            ? 'config_force_v2_all'
            : !config.enabled
              ? 'config_disabled'
              : matched
                ? 'space_list'
                : 'space_not_listed';

  return {
    isCanarySpace: canaryReason === 'space_list',
    canaryReason,
    effectiveUseV2:
      effectiveUseV2Reason === 'env_force_v2_all' ||
      effectiveUseV2Reason === 'config_force_v2_all' ||
      effectiveUseV2Reason === 'space_list',
    effectiveUseV2Reason,
    env,
    config: {
      present: config.present,
      valid: config.valid,
      enabled: config.enabled,
      forceV2All: config.forceV2All,
      spaceIdsCount: config.spaceIds.length,
      matched,
    },
  };
};

export const DebugDataLive = Layer.effect(
  DebugData,
  Effect.gen(function* () {
    const { container } = yield* Database;

    registerV2DebugData(container);
    const service = container.resolve(v2DebugDataTokens.debugDataService) as DebugDataService;
    const metaDb = container.resolve(v2MetaDbTokens.db) as Kysely<V1TeableDatabase>;
    const dataDb = container.resolve(v2DataDbTokens.db) as Kysely<V1TeableDatabase>;

    // Helper to create execution context
    const createContext = () => {
      const actorIdResult = ActorId.create('cli-debug-data');
      if (actorIdResult.isErr()) throw actorIdResult.error;
      return { actorId: actorIdResult.value };
    };

    return {
      getTableMeta: (tableId: string): Effect.Effect<DebugTableMeta | null, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const result = await service.getTableMeta(tableId);
            if (result.isErr()) throw result.error;
            return result.value;
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      getTablesByBaseId: (baseId: string): Effect.Effect<DebugTableSummary[], CliError> =>
        Effect.tryPromise({
          try: async () => {
            const result = await service.getTablesByBaseId(baseId);
            if (result.isErr()) throw result.error;
            return result.value;
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      getField: (fieldId: string): Effect.Effect<DebugFieldMeta | null, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const result = await service.getField(fieldId);
            if (result.isErr()) throw result.error;
            return result.value;
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      getFieldsByTableId: (tableId: string): Effect.Effect<DebugFieldMeta[], CliError> =>
        Effect.tryPromise({
          try: async () => {
            const result = await service.getFieldsByTableId(tableId);
            if (result.isErr()) throw result.error;
            return result.value;
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      getFieldRelationReport: (
        fieldId: string,
        options
      ): Effect.Effect<DebugFieldRelationReport, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const result = await service.getFieldRelationReport(fieldId, options);
            if (result.isErr()) throw result.error;
            return result.value;
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      // Application layer record queries (via ITableRecordQueryRepository)
      getRecords: (
        tableId: string,
        options?: RecordQueryOptions
      ): Effect.Effect<RecordQueryResult, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const tableRepo = container.resolve(v2CoreTokens.tableRepository) as ITableRepository;
            const recordQueryRepo = container.resolve(
              v2CoreTokens.tableRecordQueryRepository
            ) as ITableRecordQueryRepository;
            const context = createContext();

            // 1. Parse and load table
            const tableIdResult = TableId.create(tableId);
            if (tableIdResult.isErr()) throw tableIdResult.error;
            const tableSpec = TableByIdSpec.create(tableIdResult.value);
            const tableResult = await tableRepo.findOne(context, tableSpec);
            if (tableResult.isErr()) throw tableResult.error;
            const table = tableResult.value;
            if (!table) throw new Error(`Table "${tableId}" not found`);

            // 2. Build pagination
            const limit = options?.limit ?? 100;
            const offset = options?.offset ?? 0;
            const limitResult = PageLimit.create(limit);
            if (limitResult.isErr()) throw limitResult.error;
            const offsetResult = PageOffset.create(offset);
            if (offsetResult.isErr()) throw offsetResult.error;
            const pagination = OffsetPagination.create(limitResult.value, offsetResult.value);

            // 3. Query records
            const queryResult = await recordQueryRepo.find(context, table, undefined, {
              mode: options?.mode ?? 'stored',
              pagination,
            });
            if (queryResult.isErr()) throw queryResult.error;

            return {
              records: queryResult.value.records.map((r) => ({
                id: r.id,
                fields: r.fields,
              })),
              total: queryResult.value.total,
            };
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      getRecord: (
        tableId: string,
        recordId: string,
        mode?: 'computed' | 'stored'
      ): Effect.Effect<RecordReadModel | null, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const tableRepo = container.resolve(v2CoreTokens.tableRepository) as ITableRepository;
            const recordQueryRepo = container.resolve(
              v2CoreTokens.tableRecordQueryRepository
            ) as ITableRecordQueryRepository;
            const context = createContext();

            // 1. Parse IDs
            const tableIdResult = TableId.create(tableId);
            if (tableIdResult.isErr()) throw tableIdResult.error;
            const recordIdResult = RecordId.create(recordId);
            if (recordIdResult.isErr()) throw recordIdResult.error;

            // 2. Load table
            const tableSpec = TableByIdSpec.create(tableIdResult.value);
            const tableResult = await tableRepo.findOne(context, tableSpec);
            if (tableResult.isErr()) throw tableResult.error;
            const table = tableResult.value;
            if (!table) throw new Error(`Table "${tableId}" not found`);

            // 3. Query single record
            const result = await recordQueryRepo.findOne(context, table, recordIdResult.value, {
              mode: mode ?? 'stored',
            });
            if (result.isErr()) {
              // Not found is not an error, return null
              if (result.error.code === 'not_found') return null;
              throw result.error;
            }

            return {
              id: result.value.id,
              fields: result.value.fields,
            };
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      // Underlying database record queries (direct PostgreSQL access via debug-data service)
      getRawRecords: (
        tableId: string,
        options?: RawRecordQueryOptions
      ): Effect.Effect<RawRecordQueryResult, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const result = await service.getRawRecords(tableId, options);
            if (result.isErr()) throw result.error;
            return result.value;
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      getRawRecord: (
        tableId: string,
        recordId: string
      ): Effect.Effect<RawRecord | null, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const result = await service.getRawRecord(tableId, recordId);
            if (result.isErr()) throw result.error;
            return result.value;
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      inspectUndoCapture: (
        tableId: string
      ): Effect.Effect<UndoCaptureInspectionResult | null, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const tableMetaResult = await service.getTableMeta(tableId);
            if (tableMetaResult.isErr()) throw tableMetaResult.error;
            const tableMeta = tableMetaResult.value;
            if (!tableMeta) {
              return null;
            }

            const { schemaName, plainTableName } = splitSchemaQualifiedTableName(
              tableMeta.dbTableName
            );
            const resolvedSchemaName = schemaName ?? 'public';
            const physicalTableName = plainTableName;
            const qualifiedTableName = `${resolvedSchemaName}.${physicalTableName}`;

            const [undoLogExistsResult, captureFunctionResult, triggerResult] = await Promise.all([
              sql<{ present: boolean }>`
                SELECT to_regclass('public.__undo_log') IS NOT NULL AS present
              `.execute(dataDb),
              sql<{
                schema_name: string;
                function_name: string;
              }>`
                SELECT n.nspname AS schema_name, p.proname AS function_name
                FROM pg_proc AS p
                INNER JOIN pg_namespace AS n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = '__teable_capture_undo_row'
                LIMIT 1
              `.execute(dataDb),
              sql<{
                trigger_name: string;
                enabled_code: string;
                definition: string;
                function_schema: string;
                function_name: string;
              }>`
                SELECT
                  t.tgname AS trigger_name,
                  t.tgenabled AS enabled_code,
                  pg_get_triggerdef(t.oid, true) AS definition,
                  fn_n.nspname AS function_schema,
                  fn.proname AS function_name
                FROM pg_trigger AS t
                INNER JOIN pg_class AS cls ON cls.oid = t.tgrelid
                INNER JOIN pg_namespace AS cls_n ON cls_n.oid = cls.relnamespace
                INNER JOIN pg_proc AS fn ON fn.oid = t.tgfoid
                INNER JOIN pg_namespace AS fn_n ON fn_n.oid = fn.pronamespace
                WHERE NOT t.tgisinternal
                  AND cls_n.nspname = ${resolvedSchemaName}
                  AND cls.relname = ${physicalTableName}
                  AND t.tgname = '__teable_undo_capture'
                LIMIT 1
              `.execute(dataDb),
            ]);
            const undoLogTableExists = Boolean(undoLogExistsResult.rows[0]?.present);
            const captureFunctionRow = captureFunctionResult.rows[0];
            const triggerRow = triggerResult.rows[0];

            let pendingRowCount = 0;
            let pendingBatchCount = 0;
            let latestCreatedAt: string | null = null;
            if (undoLogTableExists) {
              const undoLogStatsResult = await sql<{
                pending_row_count: number;
                pending_batch_count: number;
                latest_created_at: Date | null;
              }>`
                SELECT
                  COUNT(*)::int AS pending_row_count,
                  COUNT(DISTINCT batch_id)::int AS pending_batch_count,
                  MAX(created_at) AS latest_created_at
                FROM public.__undo_log
                WHERE table_name = ${qualifiedTableName}
              `.execute(dataDb);
              const undoLogStatsRow = undoLogStatsResult.rows[0];
              pendingRowCount = Number(undoLogStatsRow?.pending_row_count ?? 0);
              pendingBatchCount = Number(undoLogStatsRow?.pending_batch_count ?? 0);
              latestCreatedAt = toIso(undoLogStatsRow?.latest_created_at ?? null);
            }

            const triggerEnabledCode = triggerRow?.enabled_code ?? null;
            const triggerIsEnabled = triggerEnabledCode != null && triggerEnabledCode !== 'D';

            return {
              table: {
                tableId: tableMeta.id,
                tableName: tableMeta.name,
                dbTableName: tableMeta.dbTableName,
                schemaName: resolvedSchemaName,
                physicalTableName,
              },
              infrastructure: {
                undoLogTableExists,
                captureFunctionExists: captureFunctionRow != null,
                ready:
                  undoLogTableExists &&
                  captureFunctionRow != null &&
                  triggerRow != null &&
                  triggerIsEnabled,
              },
              captureFunction: {
                present: captureFunctionRow != null,
                schema: captureFunctionRow?.schema_name ?? null,
                name: captureFunctionRow?.function_name ?? null,
              },
              trigger: {
                present: triggerRow != null,
                name: triggerRow?.trigger_name ?? '__teable_undo_capture',
                enabledCode: triggerEnabledCode,
                isEnabled: triggerIsEnabled,
                functionSchema: triggerRow?.function_schema ?? null,
                functionName: triggerRow?.function_name ?? null,
                definition: triggerRow?.definition ?? null,
              },
              undoLog: {
                tableExists: undoLogTableExists,
                pendingRowCount,
                pendingBatchCount,
                latestCreatedAt,
              },
            };
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      checkCanarySpace: (input): Effect.Effect<CanarySpaceCheckResult | null, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const env = {
              enableCanaryFeature: process.env.ENABLE_CANARY_FEATURE === 'true',
              forceV2All: process.env.FORCE_V2_ALL === 'true',
            };

            const base = input.baseId
              ? await metaDb
                  .selectFrom('base')
                  .select(['id', 'name', 'space_id as spaceId', 'deleted_time as deletedTime'])
                  .where('id', '=', input.baseId)
                  .executeTakeFirst()
              : null;

            if (input.baseId && !base) {
              return null;
            }

            const resolvedSpaceId = input.spaceId ?? base?.spaceId;
            if (!resolvedSpaceId) {
              throw new Error('Either spaceId or baseId is required');
            }

            const space = await metaDb
              .selectFrom('space')
              .select(['id', 'name', 'deleted_time as deletedTime'])
              .where('id', '=', resolvedSpaceId)
              .executeTakeFirst();

            const settingResult = await sql<{ content: string | null }>`
              SELECT content
              FROM setting
              WHERE name = 'canaryConfig'
              LIMIT 1
            `.execute(metaDb);

            const config = parseCanaryConfig(settingResult.rows[0]?.content);
            const decision = resolveCanaryMembership(env, config, resolvedSpaceId);

            return {
              target: {
                source: input.spaceId ? 'space-id' : 'base-id',
                base: base
                  ? {
                      id: base.id,
                      name: base.name,
                      deletedTime: toIso(base.deletedTime),
                    }
                  : null,
                space: {
                  id: resolvedSpaceId,
                  name: space?.name ?? null,
                  exists: Boolean(space),
                  deletedTime: toIso(space?.deletedTime),
                },
              },
              ...decision,
            };
          },
          catch: (e) => CliError.fromUnknown(e),
        }),
    };
  })
);
