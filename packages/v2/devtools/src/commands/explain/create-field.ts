import { Command, Options } from '@effect/cli';
import { Effect, Option } from 'effect';
import type { ICreateFieldCommandInput } from '@teable/v2-core';
import { ValidationError } from '../../errors/CliError';
import { CommandExplain } from '../../services/CommandExplain';
import { Output } from '../../services/Output';
import { analyzeOption, baseIdOption, connectionOption, tableIdOption } from '../shared';

const fieldOption = Options.text('field').pipe(
  Options.withDescription('JSON field payload matching CreateFieldCommand input')
);

const orderOption = Options.text('order').pipe(
  Options.withDescription('Optional JSON order payload: {"viewId":"...","orderIndex":0}'),
  Options.optional
);

const parseJson = <T>(json: string, field: string): Effect.Effect<T, ValidationError> =>
  Effect.try({
    try: () => JSON.parse(json) as T,
    catch: () => new ValidationError({ message: `Invalid JSON in --${field}`, field }),
  });

const parseOptionalJson = <T>(
  json: Option.Option<string>,
  field: string
): Effect.Effect<T | undefined, ValidationError> => {
  const raw = Option.getOrUndefined(json);
  if (!raw) return Effect.succeed(undefined);
  return parseJson<T>(raw, field);
};

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly baseId: string;
  readonly tableId: string;
  readonly field: string;
  readonly order: Option.Option<string>;
  readonly analyze: boolean;
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const output = yield* Output;

    const field = yield* parseJson<ICreateFieldCommandInput['field']>(args.field, 'field');
    const order = yield* parseOptionalJson<ICreateFieldCommandInput['order']>(args.order, 'order');
    const input = {
      baseId: args.baseId,
      tableId: args.tableId,
      field,
      order,
      analyze: args.analyze,
    };

    const result = yield* commandExplain.explainCreateField(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('explain.create-field', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('explain.create-field', input, result);
  });

export const explainCreateField = Command.make(
  'create-field',
  {
    connection: connectionOption,
    baseId: baseIdOption,
    tableId: tableIdOption,
    field: fieldOption,
    order: orderOption,
    analyze: analyzeOption,
  },
  handler
).pipe(Command.withDescription('Explain CreateField command execution plan'));
