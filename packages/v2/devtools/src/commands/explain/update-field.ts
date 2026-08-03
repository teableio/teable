import { Command, Options } from '@effect/cli';
import { Effect, Option } from 'effect';
import type { IFieldUpdateInput } from '@teable/v2-core';
import { ValidationError } from '../../errors/CliError';
import { CommandExplain } from '../../services/CommandExplain';
import { Output } from '../../services/Output';
import { analyzeOption, connectionOption, fieldIdOption, tableIdOption } from '../shared';

const fieldOption = Options.text('field').pipe(
  Options.withDescription('JSON field update payload matching UpdateFieldCommand input')
);

const parseJson = <T>(json: string, field: string): Effect.Effect<T, ValidationError> =>
  Effect.try({
    try: () => JSON.parse(json) as T,
    catch: () => new ValidationError({ message: `Invalid JSON in --${field}`, field }),
  });

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly fieldId: string;
  readonly field: string;
  readonly analyze: boolean;
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const output = yield* Output;

    const field = yield* parseJson<IFieldUpdateInput>(args.field, 'field');
    const input = {
      tableId: args.tableId,
      fieldId: args.fieldId,
      field,
      analyze: args.analyze,
    };

    const result = yield* commandExplain.explainUpdateField(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('explain.update-field', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('explain.update-field', input, result);
  });

export const explainUpdateField = Command.make(
  'update-field',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    fieldId: fieldIdOption,
    field: fieldOption,
    analyze: analyzeOption,
  },
  handler
).pipe(Command.withDescription('Explain UpdateField command execution plan'));
