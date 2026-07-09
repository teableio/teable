import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';
import { connectionOption, limitOption, optionToUndefined, tableIdOption } from '../shared';

const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(
  Options.withDefault(false),
  Options.withDescription('Do not create Table Query Ops metadata tables before analysis')
);

const maxIndexesOption = Options.integer('max-indexes').pipe(
  Options.withDefault(20),
  Options.withDescription('Maximum number of recommended indexes to explain')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly limit: number;
  readonly maxIndexes: number;
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
      ensureSchema: !args.noEnsureSchema,
    };

    const result = yield* tableQueryOps
      .explainSavedViews({
        tableId: args.tableId,
        limit: args.limit,
        maxIndexes: args.maxIndexes,
        ensureSchema: !args.noEnsureSchema,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('table-query-ops.explain-saved-views', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('table-query-ops.explain-saved-views', input, result);
  });

export const tableQueryOpsExplainSavedViews = Command.make(
  'explain-saved-views',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    limit: limitOption,
    maxIndexes: maxIndexesOption,
    noEnsureSchema: noEnsureSchemaOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Analyze saved view recommendations and validate candidate indexes with EXPLAIN/HypoPG'
  )
);
