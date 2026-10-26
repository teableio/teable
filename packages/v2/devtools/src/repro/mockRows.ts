import type { ITableRecordRepository, IUnitOfWork, Table, TableRecord } from '@teable/v2-core';
import { ActorId, TableByIdSpec, TableId, v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { MockRecordGenerator } from '@teable/v2-mock-records';

import { CliError } from '../errors/CliError';

export type MockRowsInput = {
  container: DependencyContainer;
  tableId: string;
  count: number;
  seed?: number;
  batchSize: number;
  dryRun: boolean;
};

export type MockRowsResult = {
  tableId: string;
  tableName: string;
  totalGenerated: number;
  totalInserted: number;
  dryRun: boolean;
  seed: number | null;
  sampleRecords: Array<{ id: string; fields: Record<string, unknown> }>;
};

const toSample = (record: TableRecord) => {
  const fields: Record<string, unknown> = {};
  for (const entry of record.fields().entries()) {
    fields[entry.fieldId.toString()] = entry.value.toValue();
  }
  return { id: record.id().toString(), fields };
};

/**
 * Shared mock-row generation used by `mock generate` and `repro computed`.
 * The generator is the existing `@teable/v2-mock-records` package; insertion
 * uses the same transactional `insertManyStream` path as `mock generate`.
 */
export const generateMockRows = async (input: MockRowsInput): Promise<MockRowsResult> => {
  const actorIdResult = ActorId.create('cli-mock-records');
  if (actorIdResult.isErr()) {
    throw CliError.fromUnknown(actorIdResult.error);
  }
  const context = { actorId: actorIdResult.value };

  const tableRepository = input.container.resolve(v2CoreTokens.tableRepository) as {
    findOne: (
      context: { actorId: ActorId },
      spec: TableByIdSpec
    ) => Promise<{ isErr: () => boolean; isOk: () => boolean; value?: Table; error?: unknown }>;
  };
  const tableRecordRepository = input.container.resolve(
    v2CoreTokens.tableRecordRepository
  ) as ITableRecordRepository;

  const tableIdResult = TableId.create(input.tableId);
  if (tableIdResult.isErr()) throw CliError.fromUnknown(tableIdResult.error);
  const tableResult = await tableRepository.findOne(
    context,
    TableByIdSpec.create(tableIdResult.value)
  );
  if (tableResult.isErr()) throw CliError.fromUnknown(tableResult.error);
  const table = tableResult.value;
  if (!table) {
    throw new CliError({ message: `Table not found: ${input.tableId}`, code: 'TABLE_NOT_FOUND' });
  }

  const generator = MockRecordGenerator.create({
    count: input.count,
    seed: input.seed,
    batchSize: input.batchSize,
  });

  const sampleRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const allBatches: Array<ReadonlyArray<TableRecord>> = [];
  for await (const batch of generator.generateForTable(table)) {
    for (const record of batch) {
      if (sampleRecords.length < 5) sampleRecords.push(toSample(record));
    }
    allBatches.push(batch);
  }
  const totalGenerated = allBatches.reduce((total, batch) => total + batch.length, 0);

  if (input.dryRun) {
    return {
      tableId: input.tableId,
      tableName: table.name().toString(),
      totalGenerated,
      totalInserted: 0,
      dryRun: true,
      seed: input.seed ?? null,
      sampleRecords,
    };
  }

  const unitOfWork = input.container.resolve(v2CoreTokens.unitOfWork) as IUnitOfWork;
  const insertResult = await unitOfWork.withTransaction(context, (txContext) =>
    tableRecordRepository.insertManyStream(txContext, table, allBatches)
  );

  if (insertResult.isErr()) {
    throw new CliError({
      message: `Failed to insert records: ${insertResult.error.message}`,
      code: 'INSERT_FAILED',
    });
  }

  return {
    tableId: input.tableId,
    tableName: table.name().toString(),
    totalGenerated: insertResult.value.totalInserted,
    totalInserted: insertResult.value.totalInserted,
    dryRun: false,
    seed: input.seed ?? null,
    sampleRecords,
  };
};
