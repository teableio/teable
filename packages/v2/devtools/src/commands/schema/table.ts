import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { SchemaChecker } from '../../services/SchemaChecker';
import { connectionOption, tableIdOption } from '../shared';

const handler = (args: { readonly connection: Option.Option<string>; readonly tableId: string }) =>
  Effect.gen(function* () {
    const schemaChecker = yield* SchemaChecker;
    const output = yield* Output;

    const input = { tableId: args.tableId };

    const result = yield* schemaChecker.checkTable(args.tableId).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('schema.table', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('schema.table', input, result);
  });

export const schemaTable = Command.make(
  'table',
  {
    connection: connectionOption,
    tableId: tableIdOption,
  },
  handler
).pipe(Command.withDescription('Check schema for all fields in a table'));
