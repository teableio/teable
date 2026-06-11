import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { CliError } from '../../errors/CliError';
import { Output } from '../../services/Output';
import {
  ComputedTaskInspector,
  type ComputedTaskStatus,
} from '../../services/ComputedTaskInspector';
import {
  baseIdsOption,
  csvPathOption,
  connectionOption,
  limitOption,
  offsetOption,
  optionToUndefined,
  parseCsv,
  staleHoursOption,
  tableIdsOption,
  tableMatchOption,
  updatedFromOption,
  updatedToOption,
} from '../shared';
import { asCsvTable, writeTableCsv } from '../../utils';

const statusesOption = Options.text('statuses').pipe(
  Options.withDescription('Comma-separated statuses: pending,processing,dead'),
  Options.optional
);

const parseStatuses = (value: string | undefined): ComputedTaskStatus[] => {
  const parsed = parseCsv(value);
  if (!parsed.length) return ['pending', 'processing'];
  const allowed = new Set(['pending', 'processing', 'dead']);
  const invalid = parsed.filter((status) => !allowed.has(status));
  if (invalid.length) {
    throw new CliError({
      message: `Invalid statuses: ${invalid.join(', ')}`,
      code: 'INVALID_STATUS',
      details: { invalid, allowed: [...allowed] },
    });
  }
  return parsed as ComputedTaskStatus[];
};

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly baseIds: Option.Option<string>;
  readonly tableIds: Option.Option<string>;
  readonly tableMatch: 'seed' | 'target' | 'any';
  readonly csvPath: Option.Option<string>;
  readonly statuses: Option.Option<string>;
  readonly staleHours: number;
  readonly limit: number;
  readonly offset: number;
  readonly updatedFrom: Option.Option<string>;
  readonly updatedTo: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const computedTaskInspector = yield* ComputedTaskInspector;
    const output = yield* Output;
    const baseIds = parseCsv(optionToUndefined(args.baseIds));
    const tableIds = parseCsv(optionToUndefined(args.tableIds));
    const csvPath = optionToUndefined(args.csvPath);
    const updatedFrom = optionToUndefined(args.updatedFrom);
    const updatedTo = optionToUndefined(args.updatedTo);

    const input = {
      connection: optionToUndefined(args.connection),
      ...(baseIds.length ? { baseIds } : {}),
      ...(tableIds.length ? { tableIds, tableMatch: args.tableMatch } : {}),
      ...(csvPath ? { csvPath } : {}),
      statuses: parseStatuses(optionToUndefined(args.statuses)),
      staleHours: args.staleHours,
      limit: args.limit,
      offset: args.offset,
      ...(updatedFrom ? { updatedFrom } : {}),
      ...(updatedTo ? { updatedTo } : {}),
    };

    const result = yield* computedTaskInspector
      .listTasks({
        baseIds,
        tableIds,
        tableMatch: args.tableMatch,
        statuses: input.statuses,
        staleHours: input.staleHours,
        limit: input.limit,
        offset: input.offset,
        updatedFrom,
        updatedTo,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('computed.tasks', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    const csvExport = csvPath
      ? yield* Effect.tryPromise({
          try: () => writeTableCsv(csvPath, asCsvTable(result.taskTable)),
          catch: (error) => error,
        })
      : undefined;

    yield* output.success('computed.tasks', input, {
      ...result,
      ...(csvExport ? { csvExport: { ...csvExport, table: 'task' } } : {}),
    });
  });

export const computedTasks = Command.make(
  'tasks',
  {
    connection: connectionOption,
    baseIds: baseIdsOption,
    tableIds: tableIdsOption,
    tableMatch: tableMatchOption,
    csvPath: csvPathOption,
    statuses: statusesOption,
    staleHours: staleHoursOption,
    limit: limitOption,
    offset: offsetOption,
    updatedFrom: updatedFromOption,
    updatedTo: updatedToOption,
  },
  handler
).pipe(
  Command.withDescription(
    'List current computed backlog tasks or archived dead-letter tasks with filters'
  )
);
