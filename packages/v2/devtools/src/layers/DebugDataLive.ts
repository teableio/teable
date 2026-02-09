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
import { Effect, Layer } from 'effect';
import { CliError } from '../errors/CliError';
import { Database } from '../services/Database';
import {
  DebugData,
  type RecordQueryOptions,
  type RecordQueryResult,
  type RecordReadModel,
  type RawRecordQueryOptions,
  type RawRecordQueryResult,
  type RawRecord,
} from '../services/DebugData';

export const DebugDataLive = Layer.effect(
  DebugData,
  Effect.gen(function* () {
    const { container } = yield* Database;

    registerV2DebugData(container);
    const service = container.resolve(v2DebugDataTokens.debugDataService) as DebugDataService;

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
    };
  })
);
