import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { DebugData } from '../../services/DebugData';
import { Output } from '../../services/Output';
import { connectionOption, tableIdOption } from '../shared';

const handler = (args: { readonly connection: Option.Option<string>; readonly tableId: string }) =>
  Effect.gen(function* () {
    const debugData = yield* DebugData;
    const output = yield* Output;

    const input = { tableId: args.tableId };

    const result = yield* debugData.getTableMeta(args.tableId).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('underlying.table', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    if (!result) {
      yield* output.empty(
        'underlying.table',
        input,
        `Table "${args.tableId}" not found. Check if the table ID is correct.`
      );
      return;
    }

    yield* output.success('underlying.table', input, result);
  });

export const underlyingTable = Command.make(
  'table',
  {
    connection: connectionOption,
    tableId: tableIdOption,
  },
  handler
).pipe(Command.withDescription('Get table metadata from underlying database'));
