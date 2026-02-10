import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { DebugData } from '../../services/DebugData';
import { Output } from '../../services/Output';
import { connectionOption, baseIdOption } from '../shared';

const handler = (args: { readonly connection: Option.Option<string>; readonly baseId: string }) =>
  Effect.gen(function* () {
    const debugData = yield* DebugData;
    const output = yield* Output;

    const input = { baseId: args.baseId };

    const result = yield* debugData.getTablesByBaseId(args.baseId).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('underlying.tables', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    if (!result || result.length === 0) {
      yield* output.empty(
        'underlying.tables',
        input,
        `No tables found in base "${args.baseId}". Check if the base ID is correct.`
      );
      return;
    }

    yield* output.success('underlying.tables', input, result);
  });

export const underlyingTables = Command.make(
  'tables',
  {
    connection: connectionOption,
    baseId: baseIdOption,
  },
  handler
).pipe(Command.withDescription('List all tables in a base from underlying database'));
