import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { TableQueryOps } from '../../services/TableQueryOps';
import {
  baseIdOptionalOption,
  connectionOption,
  limitOption,
  optionToUndefined,
  spaceIdOptionalOption,
  tableIdOptionalOption,
} from '../shared';

const noEnsureSchemaOption = Options.boolean('no-ensure-schema').pipe(
  Options.withDefault(false),
  Options.withDescription('Do not create Table Query Ops metadata tables before analysis')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly spaceId: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: Option.Option<string>;
  readonly limit: number;
  readonly noEnsureSchema: boolean;
}) =>
  Effect.gen(function* () {
    const tableQueryOps = yield* TableQueryOps;
    const output = yield* Output;
    const spaceId = optionToUndefined(args.spaceId);
    const baseId = optionToUndefined(args.baseId);
    const tableId = optionToUndefined(args.tableId);
    const input = {
      connection: optionToUndefined(args.connection),
      ...(spaceId ? { spaceId } : {}),
      ...(baseId ? { baseId } : {}),
      ...(tableId ? { tableId } : {}),
      limit: args.limit,
      ensureSchema: !args.noEnsureSchema,
    };

    const result = yield* tableQueryOps
      .analyzeSavedViews({
        ...(spaceId ? { spaceId } : {}),
        ...(baseId ? { baseId } : {}),
        ...(tableId ? { tableId } : {}),
        limit: args.limit,
        ensureSchema: !args.noEnsureSchema,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('table-query-ops.analyze-saved-views', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('table-query-ops.analyze-saved-views', input, result);
  });

export const tableQueryOpsAnalyzeSavedViews = Command.make(
  'analyze-saved-views',
  {
    connection: connectionOption,
    spaceId: spaceIdOptionalOption,
    baseId: baseIdOptionalOption,
    tableId: tableIdOptionalOption,
    limit: limitOption,
    noEnsureSchema: noEnsureSchemaOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Scan saved view filter/sort/group configs and create Table Query Ops recommendations'
  )
);
