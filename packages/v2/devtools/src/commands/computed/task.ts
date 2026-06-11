import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { Output } from '../../services/Output';
import type { ComputedTaskRow } from '../../services/ComputedTaskInspector';
import { ComputedTaskInspector } from '../../services/ComputedTaskInspector';
import { asCsvTable, writeTableCsv } from '../../utils';
import { connectionOption, csvPathOption, optionToUndefined, staleHoursOption } from '../shared';

const taskIdOption = Options.text('task-id').pipe(
  Options.withDescription('Computed task ID (cuo...)')
);

const sourceOption = Options.choice('source', ['auto', 'outbox', 'dead-letter']).pipe(
  Options.withDefault('auto' as const),
  Options.withDescription('Where to look for the task')
);

const csvTableOption = Options.choice('csv-table', ['task', 'edge-mode', 'target']).pipe(
  Options.withDefault('target' as const),
  Options.withDescription('Which result table to export when --csv-path is provided')
);

const taskCsvColumns: ReadonlyArray<keyof ComputedTaskRow & string> = [
  'id',
  'source',
  'status',
  'baseId',
  'baseName',
  'seedTableId',
  'tableName',
  'changeType',
  'lockedBy',
  'estimatedComplexity',
  'runCompletedStepsBefore',
  'runTotalSteps',
  'stale',
  'hasAllTargetRecords',
  'edgeCount',
  'updatedAt',
  'nextRunAt',
  'lastError',
];

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly csvPath: Option.Option<string>;
  readonly csvTable: 'task' | 'edge-mode' | 'target';
  readonly taskId: string;
  readonly source: 'auto' | 'outbox' | 'dead-letter';
  readonly staleHours: number;
}) =>
  Effect.gen(function* () {
    const computedTaskInspector = yield* ComputedTaskInspector;
    const output = yield* Output;
    const csvPath = optionToUndefined(args.csvPath);

    const input = {
      connection: optionToUndefined(args.connection),
      ...(csvPath ? { csvPath, csvTable: args.csvTable } : {}),
      taskId: args.taskId,
      source: args.source,
      staleHours: args.staleHours,
    };

    const result = yield* computedTaskInspector
      .getTaskDetail({
        taskId: input.taskId,
        source: input.source,
        staleHours: input.staleHours,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('computed.task', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    const selectedTable =
      args.csvTable === 'task'
        ? { columns: taskCsvColumns, rows: [result.task] }
        : args.csvTable === 'edge-mode'
          ? result.edgeModeTable
          : result.targetTable;

    const csvExport = csvPath
      ? yield* Effect.tryPromise({
          try: () => writeTableCsv(csvPath, asCsvTable(selectedTable)),
          catch: (error) => error,
        })
      : undefined;

    yield* output.success('computed.task', input, {
      ...result,
      ...(csvExport ? { csvExport: { ...csvExport, table: args.csvTable } } : {}),
    });
  });

export const computedTask = Command.make(
  'task',
  {
    connection: connectionOption,
    csvPath: csvPathOption,
    csvTable: csvTableOption,
    taskId: taskIdOption,
    source: sourceOption,
    staleHours: staleHoursOption,
  },
  handler
).pipe(Command.withDescription('Inspect one computed outbox or dead-letter task by ID'));
