import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';
import { connectionOption, limitOption, optionToUndefined, tableIdOption } from '../shared';

const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(
  Options.withDefault(false),
  Options.withDescription('Do not create Table Query Ops metadata tables before execution')
);

const executeOption = Options.boolean('execute').pipe(
  Options.withDefault(false),
  Options.withDescription('Actually execute accepted recommended indexes through Table Query Ops')
);

const maxIndexesOption = Options.integer('max-indexes').pipe(
  Options.withDefault(1000),
  Options.withDescription('Maximum number of recommended indexes to execute or dry-run')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly limit: number;
  readonly maxIndexes: number;
  readonly execute: boolean;
  readonly noEnsureSchema: boolean;
}) =>
  Effect.gen(function* () {
    const tableQueryOps = yield* TableQueryOps;
    const output = yield* Output;
    const input = {
      connection: optionToUndefined(args.connection),
      tableId: args.tableId,
      limit: args.limit,
      maxIndexes: args.maxIndexes,
      execute: args.execute,
      ensureSchema: !args.noEnsureSchema,
    };

    const result = yield* tableQueryOps
      .executeRecommendations({
        tableId: args.tableId,
        limit: args.limit,
        maxIndexes: args.maxIndexes,
        execute: args.execute,
        ensureSchema: !args.noEnsureSchema,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('table-query-ops.execute-recommendations', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('table-query-ops.execute-recommendations', input, result);
  });

export const tableQueryOpsExecuteRecommendations = Command.make(
  'execute-recommendations',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    limit: limitOption,
    maxIndexes: maxIndexesOption,
    execute: executeOption,
    noEnsureSchema: noEnsureSchemaOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Dry-run or execute consolidated Table Query Ops recommended indexes through commands'
  )
);
