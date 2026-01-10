import { Effect, Layer } from 'effect';
import { Database } from '../services/Database';
import {
  MockRecords,
  type MockGenerateInput,
  type MockGenerateResult,
} from '../services/MockRecords';
import { CliError } from '../errors/CliError';
import {
  v2CoreTokens,
  TableId,
  TableByIdSpec,
  ActorId,
  type ITableRepository,
  type ITableRecordRepository,
  type IUnitOfWork,
  type Table,
} from '@teable/v2-core';
import { MockRecordGenerator } from '@teable/v2-mock-records';

export const MockRecordsLive = Layer.effect(
  MockRecords,
  Effect.gen(function* () {
    const { container } = yield* Database;

    return {
      generate: (input: MockGenerateInput) =>
        Effect.gen(function* () {
          // Parse table ID
          const tableIdResult = TableId.create(input.tableId);
          if (tableIdResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(tableIdResult.error));
          }
          const tableId = tableIdResult.value;

          // Create execution context
          const actorIdResult = ActorId.create('cli-mock-records');
          if (actorIdResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(actorIdResult.error));
          }
          const context = { actorId: actorIdResult.value };

          const tableRepository = container.resolve(
            v2CoreTokens.tableRepository
          ) as ITableRepository;
          const tableRecordRepository = container.resolve(
            v2CoreTokens.tableRecordRepository
          ) as ITableRecordRepository;

          // Load table
          const tableResult = yield* Effect.tryPromise({
            try: () => tableRepository.findOne(context, TableByIdSpec.create(tableId)),
            catch: (e) => CliError.fromUnknown(e),
          });

          if (tableResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(tableResult.error));
          }

          const table = tableResult.value;
          if (!table) {
            return yield* Effect.fail(
              new CliError({
                message: `Table "${input.tableId}" not found`,
                code: 'TABLE_NOT_FOUND',
              })
            );
          }

          // Create generator
          const generator = MockRecordGenerator.create({
            count: input.count,
            seed: input.seed,
            batchSize: input.batchSize,
          });

          const sampleRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];

          if (input.dryRun) {
            // Dry run: collect samples without inserting
            let totalGenerated = 0;

            const collectSamples = yield* Effect.tryPromise({
              try: async () => {
                for await (const batch of generator.generateForTable(table)) {
                  totalGenerated += batch.length;
                  for (const record of batch) {
                    if (sampleRecords.length < 5) {
                      const fields: Record<string, unknown> = {};
                      for (const entry of record.fields().entries()) {
                        fields[entry.fieldId.toString()] = entry.value.toValue();
                      }
                      sampleRecords.push({
                        id: record.id().toString(),
                        fields,
                      });
                    }
                  }
                }
                return totalGenerated;
              },
              catch: (e) => CliError.fromUnknown(e),
            });

            return {
              tableId: input.tableId,
              tableName: table.name().toString(),
              totalGenerated: collectSamples,
              totalInserted: 0,
              dryRun: true,
              seed: input.seed ?? null,
              sampleRecords,
            } satisfies MockGenerateResult;
          }

          // Actual insert using insertManyStream wrapped in transaction
          const unitOfWork = container.resolve(v2CoreTokens.unitOfWork) as IUnitOfWork;

          const insertResult = yield* Effect.tryPromise({
            try: async () => {
              // Pre-generate all batches before starting transaction
              // (async generators can't be restarted, so we materialize them first)
              const allBatches: Array<ReadonlyArray<import('@teable/v2-core').TableRecord>> = [];
              for await (const batch of generator.generateForTable(table as Table)) {
                for (const record of batch) {
                  if (sampleRecords.length < 5) {
                    const fields: Record<string, unknown> = {};
                    for (const entry of record.fields().entries()) {
                      fields[entry.fieldId.toString()] = entry.value.toValue();
                    }
                    sampleRecords.push({
                      id: record.id().toString(),
                      fields,
                    });
                  }
                }
                allBatches.push(batch);
              }

              return unitOfWork.withTransaction(context, async (txContext) => {
                return tableRecordRepository.insertManyStream(txContext, table, allBatches);
              });
            },
            catch: (e) => CliError.fromUnknown(e),
          });

          // insertResult is Result<Result<InsertManyStreamResult, DomainError>, CliError>
          // First check the outer Result (from Effect.tryPromise)
          if (insertResult.isErr()) {
            return yield* Effect.fail(
              new CliError({
                message: `Failed to insert records: ${insertResult.error.message}`,
                code: 'INSERT_FAILED',
              })
            );
          }

          // Then check the inner Result (from unitOfWork.withTransaction)
          const txResult = insertResult.value;

          // txResult should be Result<InsertManyStreamResult, DomainError>
          // Check if it's a Result object with isErr method
          if (
            typeof txResult === 'object' &&
            txResult !== null &&
            'isErr' in txResult &&
            typeof (txResult as { isErr: unknown }).isErr === 'function'
          ) {
            const resultObj = txResult as {
              isErr: () => boolean;
              error: { message: string };
              value: { totalInserted: number };
            };
            if (resultObj.isErr()) {
              return yield* Effect.fail(
                new CliError({
                  message: `Failed to insert records: ${resultObj.error.message}`,
                  code: 'INSERT_FAILED',
                })
              );
            }
            const { totalInserted } = resultObj.value;
            return {
              tableId: input.tableId,
              tableName: table.name().toString(),
              totalGenerated: totalInserted,
              totalInserted,
              dryRun: false,
              seed: input.seed ?? null,
              sampleRecords,
            } satisfies MockGenerateResult;
          }

          // If txResult is directly InsertManyStreamResult (shouldn't happen but handle it)
          const directResult = txResult as { totalInserted: number };
          return {
            tableId: input.tableId,
            tableName: table.name().toString(),
            totalGenerated: directResult.totalInserted,
            totalInserted: directResult.totalInserted,
            dryRun: false,
            seed: input.seed ?? null,
            sampleRecords,
          } satisfies MockGenerateResult;
        }),
    };
  })
);
