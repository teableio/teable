import { Command } from '@effect/cli';
import { Effect, Option } from 'effect';
import { CommandExplain } from '../../services/CommandExplain';
import { Output } from '../../services/Output';
import {
  analyzeOption,
  baseIdOptionalOption,
  connectionOption,
  fieldIdOption,
  tableIdOption,
} from '../shared';

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: string;
  readonly fieldId: string;
  readonly analyze: boolean;
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const output = yield* Output;

    const input = {
      baseId: Option.getOrUndefined(args.baseId),
      tableId: args.tableId,
      fieldId: args.fieldId,
      analyze: args.analyze,
    };

    const result = yield* commandExplain.explainDeleteField(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('explain.delete-field', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('explain.delete-field', input, result);
  });

export const explainDeleteField = Command.make(
  'delete-field',
  {
    connection: connectionOption,
    baseId: baseIdOptionalOption,
    tableId: tableIdOption,
    fieldId: fieldIdOption,
    analyze: analyzeOption,
  },
  handler
).pipe(Command.withDescription('Explain DeleteField command execution plan'));
