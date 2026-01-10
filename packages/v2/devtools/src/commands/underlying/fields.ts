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

    const result = yield* debugData.getFieldsByTableId(args.tableId).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('underlying.fields', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    if (!result || result.length === 0) {
      yield* output.empty(
        'underlying.fields',
        input,
        `No fields found for table "${args.tableId}". Check if the table ID is correct.`
      );
      return;
    }

    yield* output.success('underlying.fields', input, result);
  });

export const underlyingFields = Command.make(
  'fields',
  {
    connection: connectionOption,
    tableId: tableIdOption,
  },
  handler
).pipe(Command.withDescription('List all fields in a table from underlying database'));
