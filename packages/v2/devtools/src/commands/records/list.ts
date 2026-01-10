import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { DebugData } from '../../services/DebugData';
import { Output } from '../../services/Output';
import { connectionOption, tableIdOption, limitOption, offsetOption, modeOption } from '../shared';

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly limit: number;
  readonly offset: number;
  readonly mode: 'stored' | 'computed';
}) =>
  Effect.gen(function* () {
    const debugData = yield* DebugData;
    const output = yield* Output;

    const input = {
      tableId: args.tableId,
      limit: args.limit,
      offset: args.offset,
      mode: args.mode,
    };

    const result = yield* debugData
      .getRecords(args.tableId, {
        limit: args.limit,
        offset: args.offset,
        mode: args.mode,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('records.list', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    if (result.records.length === 0) {
      yield* output.empty(
        'records.list',
        input,
        `No records found in table "${args.tableId}". The table may be empty or the offset is too large.`
      );
      return;
    }

    yield* output.success('records.list', input, result);
  });

export const recordsList = Command.make(
  'list',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    limit: limitOption,
    offset: offsetOption,
    mode: modeOption,
  },
  handler
).pipe(Command.withDescription('List records via application query repository'));
