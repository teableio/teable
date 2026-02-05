import { Command, Options } from '@effect/cli';
import { Effect, Option } from 'effect';
import { Output } from '../../services/Output';
import { TableCreator } from '../../services/TableCreator';
import { connectionOption, baseIdOption } from '../shared';

const nameOption = Options.text('name').pipe(Options.withDescription('Table name'));

const fieldsOption = Options.text('fields').pipe(
  Options.withDescription(
    'Fields JSON array (e.g., \'[{"type":"singleLineText","name":"Name","isPrimary":true}]\')'
  ),
  Options.optional
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly baseId: string;
  readonly name: string;
  readonly fields: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const tableCreator = yield* TableCreator;
    const output = yield* Output;

    // Parse fields if provided
    let fields:
      | Array<{
          type: string;
          name: string;
          isPrimary?: boolean;
          options?: Record<string, unknown>;
        }>
      | undefined;

    const fieldsJson = Option.getOrUndefined(args.fields);
    if (fieldsJson) {
      try {
        fields = JSON.parse(fieldsJson);
      } catch {
        yield* output.error(
          'tables.create',
          { baseId: args.baseId, name: args.name },
          {
            message: 'Invalid fields JSON',
            code: 'INVALID_JSON',
          }
        );
        return;
      }
    }

    const input = {
      baseId: args.baseId,
      name: args.name,
      fields,
    };

    const result = yield* tableCreator.createTable(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('tables.create', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('tables.create', input, result);
  });

export const tablesCreate = Command.make(
  'create',
  {
    connection: connectionOption,
    baseId: baseIdOption,
    name: nameOption,
    fields: fieldsOption,
  },
  handler
).pipe(Command.withDescription('Create a new table (without records)'));
