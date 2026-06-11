import { Command, Options } from '@effect/cli';
import { Effect, Option } from 'effect';
import { CommandExplain } from '../../services/CommandExplain';
import { Output } from '../../services/Output';
import { analyzeOption, baseIdOptionalOption, connectionOption, tableIdOption } from '../shared';

const deleteModeOption = Options.choice('mode', ['soft', 'permanent']).pipe(
  Options.optional,
  Options.withDescription('Delete mode: soft or permanent')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: string;
  readonly mode: Option.Option<string>;
  readonly analyze: boolean;
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const output = yield* Output;

    const input = {
      baseId: Option.getOrUndefined(args.baseId),
      tableId: args.tableId,
      mode: Option.getOrUndefined(args.mode) as 'soft' | 'permanent' | undefined,
      analyze: args.analyze,
    };

    const result = yield* commandExplain.explainDeleteTable(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('explain.delete-table', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('explain.delete-table', input, result);
  });

export const explainDeleteTable = Command.make(
  'delete-table',
  {
    connection: connectionOption,
    baseId: baseIdOptionalOption,
    tableId: tableIdOption,
    mode: deleteModeOption,
    analyze: analyzeOption,
  },
  handler
).pipe(Command.withDescription('Explain DeleteTable command execution plan'));
