import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { DebugData } from '../../services/DebugData';
import { Output } from '../../services/Output';
import { connectionOption, tableIdOption, recordIdOption, modeOption } from '../shared';

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly recordId: string;
  readonly mode: 'stored' | 'computed';
}) =>
  Effect.gen(function* () {
    const debugData = yield* DebugData;
    const output = yield* Output;

    const input = {
      tableId: args.tableId,
      recordId: args.recordId,
      mode: args.mode,
    };

    const result = yield* debugData.getRecord(args.tableId, args.recordId, args.mode).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('records.get', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    if (!result) {
      yield* output.empty(
        'records.get',
        input,
        `Record "${args.recordId}" not found in table "${args.tableId}". Check if the record ID is correct.`
      );
      return;
    }

    yield* output.success('records.get', input, result);
  });

export const recordsGet = Command.make(
  'get',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    recordId: recordIdOption,
    mode: modeOption,
  },
  handler
).pipe(Command.withDescription('Get single record via application query repository'));
