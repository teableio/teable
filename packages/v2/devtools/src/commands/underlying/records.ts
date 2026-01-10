import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { DebugData } from '../../services/DebugData';
import { Output } from '../../services/Output';
import { connectionOption, tableIdOption, limitOption, offsetOption } from '../shared';

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly limit: number;
  readonly offset: number;
}) =>
  Effect.gen(function* () {
    const debugData = yield* DebugData;
    const output = yield* Output;

    const input = {
      tableId: args.tableId,
      limit: args.limit,
      offset: args.offset,
    };

    const result = yield* debugData
      .getRawRecords(args.tableId, {
        limit: args.limit,
        offset: args.offset,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('underlying.records', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    if (result.records.length === 0) {
      yield* output.empty(
        'underlying.records',
        input,
        `No records found in table "${args.tableId}". The table may be empty or the offset is too large.`
      );
      return;
    }

    yield* output.success('underlying.records', input, result);
  });

export const underlyingRecords = Command.make(
  'records',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    limit: limitOption,
    offset: offsetOption,
  },
  handler
).pipe(Command.withDescription('List records directly from underlying PostgreSQL table'));
