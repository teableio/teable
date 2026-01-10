import { Command, Options } from '@effect/cli';
import { Effect, Option } from 'effect';
import { ValidationError } from '../../errors/CliError';
import { CommandExplain } from '../../services/CommandExplain';
import { Output } from '../../services/Output';
import { analyzeOption, connectionOption, tableIdOption } from '../shared';

const fieldsOption = Options.text('fields').pipe(
  Options.withDescription('JSON object of field values (default: {})'),
  Options.optional
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
  readonly analyze: boolean;
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const output = yield* Output;

    const fields = yield* parseFields(args.fields);
    const input = { tableId: args.tableId, fields, analyze: args.analyze };

    const result = yield* commandExplain
      .explainCreate({
        tableId: args.tableId,
        fields,
        analyze: args.analyze,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('explain.create', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('explain.create', input, result);
  });

export const explainCreate = Command.make(
  'create',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    fields: fieldsOption,
    analyze: analyzeOption,
  },
  handler
).pipe(Command.withDescription('Explain CreateRecord command execution plan'));
