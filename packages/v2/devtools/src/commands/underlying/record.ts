import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { DebugData } from '../../services/DebugData';
import { Output } from '../../services/Output';
import { connectionOption, tableIdOption, recordIdOption } from '../shared';

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly recordId: string;
}) =>
  Effect.gen(function* () {
    const debugData = yield* DebugData;
    const output = yield* Output;

    const input = {
      tableId: args.tableId,
      recordId: args.recordId,
    };

    const result = yield* debugData.getRawRecord(args.tableId, args.recordId).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('underlying.record', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    if (!result) {
      yield* output.empty(
        'underlying.record',
        input,
        `Record "${args.recordId}" not found in table "${args.tableId}". Check if the record ID is correct.`
      );
      return;
    }

    yield* output.success('underlying.record', input, result);
  });

export const underlyingRecord = Command.make(
  'record',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    recordId: recordIdOption,
  },
  handler
).pipe(Command.withDescription('Get single record directly from underlying PostgreSQL table'));
