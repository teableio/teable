import { Command, Options } from '@effect/cli';
import { Effect, Option } from 'effect';
import { ValidationError } from '../../errors/CliError';
import { Output } from '../../services/Output';
import { RecordMutation } from '../../services/RecordMutation';
import { connectionOption, tableIdOption } from '../shared';

const fieldsOption = Options.text('fields').pipe(
  Options.withDescription('JSON object of field values (default: {})'),
  Options.optional
);

const typecastOption = Options.boolean('typecast').pipe(
  Options.withDefault(false),
  Options.withDescription('Enable typecast mode to auto-convert values')
);

const parseFields = (
  json: Option.Option<string>
): Effect.Effect<Record<string, unknown>, ValidationError> => {
  const jsonStr = Option.getOrUndefined(json);
  if (!jsonStr) return Effect.succeed({});

  return Effect.try({
    try: () => JSON.parse(jsonStr) as Record<string, unknown>,
    catch: () => new ValidationError({ message: 'Invalid JSON in --fields', field: 'fields' }),
  });
};

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly fields: Option.Option<string>;
  readonly typecast: boolean;
}) =>
  Effect.gen(function* () {
    const recordMutation = yield* RecordMutation;
    const output = yield* Output;

    const fields = yield* parseFields(args.fields);
    const input = { tableId: args.tableId, fields, typecast: args.typecast };

    const result = yield* recordMutation
      .createRecord({
        tableId: args.tableId,
        fields,
        typecast: args.typecast,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('records.create', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('records.create', input, result);
  });

export const recordsCreate = Command.make(
  'create',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    fields: fieldsOption,
    typecast: typecastOption,
  },
  handler
).pipe(Command.withDescription('Create a new record via CreateRecordCommand'));
