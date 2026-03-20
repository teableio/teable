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
  topOption,
} from '../shared';

const workerIdOption = Options.text('worker-id').pipe(
  Options.withDefault('devtools-computed-replay'),
  Options.withDescription('Worker ID used for queue replay')
);

const replayLimitOption = Options.integer('limit').pipe(
  Options.withDescription('Maximum number of tasks to replay; omit for no limit'),
  Options.optional
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly baseIds: Option.Option<string>;
  readonly csvPath: Option.Option<string>;
  readonly workerId: string;
  readonly limit: Option.Option<number>;
  readonly top: number;
}) =>
  Effect.gen(function* () {
    const computedTaskInspector = yield* ComputedTaskInspector;
    const output = yield* Output;
    const baseIds = parseCsv(optionToUndefined(args.baseIds));
    const csvPath = optionToUndefined(args.csvPath);
    const limit = optionToUndefined(args.limit);

    const input = {
      connection: optionToUndefined(args.connection),
      ...(baseIds.length ? { baseIds } : {}),
      ...(csvPath ? { csvPath } : {}),
      workerId: args.workerId,
      ...(limit != null ? { limit } : {}),
      top: args.top,
    };

    const result = yield* computedTaskInspector
      .replayQueue({
        baseIds,
        workerId: input.workerId,
        limit,
        top: input.top,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('computed.replay', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    const csvExport = csvPath
      ? yield* Effect.tryPromise({
          try: () => writeTableCsv(csvPath, asCsvTable(result.remainingByBaseTable)),
          catch: (error) => error,
        })
      : undefined;

    yield* output.success('computed.replay', input, {
      ...result,
      ...(csvExport ? { csvExport: { ...csvExport, table: 'remaining-by-base' } } : {}),
    });
  });

export const computedReplay = Command.make(
  'replay',
  {
    connection: connectionOption,
    baseIds: baseIdsOption,
    csvPath: csvPathOption,
    workerId: workerIdOption,
    limit: replayLimitOption,
    top: topOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Replay current computed backlog in queue order, optionally scoped to selected bases'
  )
);
