import { Command, Options } from '@effect/cli';
import type { SchemaOperationStatus } from '@teable/v2-core';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { CliError } from '../../errors/CliError';
import { Output } from '../../services/Output';
import { SchemaOperationControl } from '../../services/SchemaOperationControl';
import {
  baseIdsOption,
  connectionOption,
  limitOption,
  offsetOption,
  optionToUndefined,
  parseCsv,
  tableIdsOption,
} from '../shared';

const statusesOption = Options.text('statuses').pipe(
  Options.withDescription('Comma-separated statuses: pending,running,ready,error,dead'),
  Options.optional
);

const typesOption = Options.text('types').pipe(
  Options.withDescription('Comma-separated schema operation types, e.g. table.create,table.import'),
  Options.optional
);

const resourceIdsOption = Options.text('resource-ids').pipe(
  Options.withDescription('Comma-separated resource IDs'),
  Options.optional
);

const parseStatuses = (value: string | undefined): SchemaOperationStatus[] | undefined => {
  const parsed = parseCsv(value);
  if (!parsed.length) return undefined;

  const allowed = new Set(['pending', 'running', 'ready', 'error', 'dead']);
  const invalid = parsed.filter((status) => !allowed.has(status));
  if (invalid.length) {
    throw new CliError({
      message: `Invalid statuses: ${invalid.join(', ')}`,
      code: 'INVALID_STATUS',
      details: { invalid, allowed: [...allowed] },
    });
  }
  return parsed as SchemaOperationStatus[];
};

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly statuses: Option.Option<string>;
  readonly types: Option.Option<string>;
  readonly baseIds: Option.Option<string>;
  readonly tableIds: Option.Option<string>;
  readonly resourceIds: Option.Option<string>;
  readonly limit: number;
  readonly offset: number;
}) =>
  Effect.gen(function* () {
    const schemaOperationControl = yield* SchemaOperationControl;
    const output = yield* Output;
    const statuses = parseStatuses(optionToUndefined(args.statuses));
    const types = parseCsv(optionToUndefined(args.types));
    const baseIds = parseCsv(optionToUndefined(args.baseIds));
    const tableIds = parseCsv(optionToUndefined(args.tableIds));
    const resourceIds = parseCsv(optionToUndefined(args.resourceIds));

    const input = {
      connection: optionToUndefined(args.connection),
      ...(statuses?.length ? { statuses } : {}),
      ...(types.length ? { types } : {}),
      ...(baseIds.length ? { baseIds } : {}),
      ...(tableIds.length ? { tableIds } : {}),
      ...(resourceIds.length ? { resourceIds } : {}),
      limit: args.limit,
      offset: args.offset,
    };

    const result = yield* schemaOperationControl
      .listOperations({
        statuses,
        types,
        baseIds,
        tableIds,
        resourceIds,
        limit: args.limit,
        offset: args.offset,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('schema-operation.list', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('schema-operation.list', input, result);
  });

export const schemaOperationList = Command.make(
  'list',
  {
    connection: connectionOption,
    statuses: statusesOption,
    types: typesOption,
    baseIds: baseIdsOption,
    tableIds: tableIdsOption,
    resourceIds: resourceIdsOption,
    limit: limitOption,
    offset: offsetOption,
  },
  handler
).pipe(Command.withDescription('List schema operations with status and last error details'));
