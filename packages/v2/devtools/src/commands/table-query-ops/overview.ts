import { Command } from '@effect/cli';
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

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly spaceId: Option.Option<string>;
  readonly baseId: Option.Option<string>;
  readonly tableId: Option.Option<string>;
  readonly limit: number;
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
    };

    const result = yield* tableQueryOps
      .getOverview({
        ...(spaceId ? { spaceId } : {}),
        ...(baseId ? { baseId } : {}),
        ...(tableId ? { tableId } : {}),
        limit: args.limit,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('table-query-ops.overview', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('table-query-ops.overview', input, result);
  });

export const tableQueryOpsOverview = Command.make(
  'overview',
  {
    connection: connectionOption,
    spaceId: spaceIdOptionalOption,
    baseId: baseIdOptionalOption,
    tableId: tableIdOptionalOption,
    limit: limitOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Read Table Query Ops observations, recommendations, tasks, and hot tables for a scope'
  )
);
