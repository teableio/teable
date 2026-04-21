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

    const result = yield* debugData.inspectUndoCapture(args.tableId).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('underlying.undo-capture', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    if (!result) {
      yield* output.empty(
        'underlying.undo-capture',
        input,
        `Table "${args.tableId}" not found. Check if the table ID is correct.`
      );
      return;
    }

    yield* output.success('underlying.undo-capture', input, result);
  });

export const underlyingUndoCapture = Command.make(
  'undo-capture',
  {
    connection: connectionOption,
    tableId: tableIdOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Inspect undo-capture trigger wiring and pending __undo_log rows for a table'
  )
);
