import { Command } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { SchemaChecker } from '../../services/SchemaChecker';
import { connectionOption, tableIdOption, fieldIdOption } from '../shared';

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly fieldId: string;
}) =>
  Effect.gen(function* () {
    const schemaChecker = yield* SchemaChecker;
    const output = yield* Output;

    const input = { tableId: args.tableId, fieldId: args.fieldId };

    const result = yield* schemaChecker.checkField(args.tableId, args.fieldId).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('schema.field', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('schema.field', input, result);
  });

export const schemaField = Command.make(
  'field',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    fieldId: fieldIdOption,
  },
  handler
).pipe(Command.withDescription('Check schema for a specific field'));
