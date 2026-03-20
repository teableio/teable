import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import { ComputedTaskInspector } from '../../services/ComputedTaskInspector';
import { asCsvTable, writeTableCsv } from '../../utils';
import {
  baseIdsOption,
  csvPathOption,
  connectionOption,
  optionToUndefined,
  parseCsv,
  staleHoursOption,
  tableIdsOption,
  tableMatchOption,
  topOption,
} from '../shared';

const csvTableOption = Options.choice('csv-table', ['status', 'base', 'table']).pipe(
  Options.withDefault('table' as const),
  Options.withDescription('Which result table to export when --csv-path is provided')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly baseIds: Option.Option<string>;
  readonly tableIds: Option.Option<string>;
  readonly tableMatch: 'seed' | 'target' | 'any';
  readonly csvPath: Option.Option<string>;
  readonly csvTable: 'status' | 'base' | 'table';
  readonly staleHours: number;
  readonly top: number;
}) =>
  Effect.gen(function* () {
    const computedTaskInspector = yield* ComputedTaskInspector;
    const output = yield* Output;
    const baseIds = parseCsv(optionToUndefined(args.baseIds));
    const tableIds = parseCsv(optionToUndefined(args.tableIds));
    const csvPath = optionToUndefined(args.csvPath);

    const input = {
      connection: optionToUndefined(args.connection),
      ...(baseIds.length ? { baseIds } : {}),
      ...(tableIds.length ? { tableIds, tableMatch: args.tableMatch } : {}),
      ...(csvPath ? { csvPath, csvTable: args.csvTable } : {}),
      staleHours: args.staleHours,
      top: args.top,
    };

    const result = yield* computedTaskInspector
      .getQueueSummary({
        baseIds,
        tableIds,
        tableMatch: args.tableMatch,
        staleHours: input.staleHours,
        top: input.top,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('computed.summary', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    const selectedTable =
      args.csvTable === 'status'
        ? result.statusTable
        : args.csvTable === 'base'
          ? result.baseTable
          : result.tableTable;

    const csvExport = csvPath
      ? yield* Effect.tryPromise({
          try: () => writeTableCsv(csvPath, asCsvTable(selectedTable)),
          catch: (error) => error,
        })
      : undefined;

    yield* output.success('computed.summary', input, {
      ...result,
      ...(csvExport ? { csvExport: { ...csvExport, table: args.csvTable } } : {}),
    });
  });

export const computedSummary = Command.make(
  'summary',
  {
    connection: connectionOption,
    baseIds: baseIdsOption,
    tableIds: tableIdsOption,
    tableMatch: tableMatchOption,
    csvPath: csvPathOption,
    csvTable: csvTableOption,
    staleHours: staleHoursOption,
    top: topOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Summarize live computed backlog and dead-letter counts by base and seed table'
  )
);
