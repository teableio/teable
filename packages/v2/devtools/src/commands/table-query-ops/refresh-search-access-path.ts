import { Command, Options } from '@effect/cli';
import { Effect } from 'effect';
import { CliError } from '../../errors';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';
import { connectionOption, optionToUndefined, tableIdOption } from '../shared';

export const tableQueryOpsRefreshSearchAccessPath = Command.make(
  'refresh-search-access-path',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    dataConnection: Options.text('data-connection').pipe(
      Options.withDescription(
        'BYODB connection holding the physical table; --connection is metadata'
      ),
      Options.optional
    ),
    execute: Options.boolean('execute').pipe(
      Options.withDefault(false),
      Options.withDescription('Confirm publishing or revoking the validated table search path')
    ),
  },
  ({ tableId, execute, dataConnection }) =>
    Effect.gen(function* () {
      const output = yield* Output;
      const tableQueryOps = yield* TableQueryOps;
      const input = { tableId };
      const result = yield* (
        execute
          ? tableQueryOps.refreshSearchAccessPath({
              ...input,
              dataConnection: optionToUndefined(dataConnection),
            })
          : Effect.fail(
              CliError.fromUnknown(new Error('refresh-search-access-path requires --execute'))
            )
      ).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('table-query-ops.refresh-search-access-path', input, error);
            return yield* Effect.fail(error);
          })
        )
      );
      yield* output.success('table-query-ops.refresh-search-access-path', input, result);
    })
).pipe(
  Command.withDescription(
    'Inspect an existing index and publish its serving metadata; no index DDL or rebuild'
  )
);
