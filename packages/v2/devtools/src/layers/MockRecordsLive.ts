import { TableId } from '@teable/v2-core';
import { Effect, Layer } from 'effect';

import { CliError } from '../errors/CliError';
import { generateMockRows } from '../repro/mockRows';
import { Database } from '../services/Database';
import {
  MockRecords,
  type MockGenerateInput,
  type MockGenerateResult,
} from '../services/MockRecords';

export const MockRecordsLive = Layer.effect(
  MockRecords,
  Effect.gen(function* () {
    const { container } = yield* Database;

    return {
      generate: (input: MockGenerateInput) =>
        Effect.gen(function* () {
          const tableIdResult = TableId.create(input.tableId);
          if (tableIdResult.isErr()) {
            return yield* Effect.fail(CliError.fromUnknown(tableIdResult.error));
          }

          return yield* Effect.tryPromise({
            try: () =>
              generateMockRows({
                container,
                tableId: input.tableId,
                count: input.count,
                seed: input.seed,
                batchSize: input.batchSize,
                dryRun: input.dryRun,
              }),
            catch: (error) => CliError.fromUnknown(error),
          }) satisfies Effect.Effect<MockGenerateResult, CliError>;
        }),
    };
  })
);
