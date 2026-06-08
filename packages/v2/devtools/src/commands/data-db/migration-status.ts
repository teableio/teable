import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import { DataDbMigrationInspector } from '../../services/DataDbMigrationInspector';
import { Output } from '../../services/Output';
import { connectionOption, limitOption, optionToUndefined, spaceIdOptionalOption } from '../shared';

const jobIdOption = Options.text('job-id').pipe(
  Options.withDescription('Migration job ID (sdmj...)'),
  Options.optional
);

const includeHistoryOption = Options.boolean('include-history').pipe(
  Options.withDefault(false),
  Options.withDescription('Include succeeded, failed, canceled, and rolled_back migration jobs')
);

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly spaceId: Option.Option<string>;
  readonly jobId: Option.Option<string>;
  readonly includeHistory: boolean;
  readonly limit: number;
}) =>
  Effect.gen(function* () {
    const inspector = yield* DataDbMigrationInspector;
    const output = yield* Output;
    const spaceId = optionToUndefined(args.spaceId);
    const jobId = optionToUndefined(args.jobId);
    const input = {
      connection: optionToUndefined(args.connection),
      ...(spaceId ? { spaceId } : {}),
      ...(jobId ? { jobId } : {}),
      includeHistory: args.includeHistory,
      limit: args.limit,
    };

    const result = yield* inspector
      .getStatus({
        ...(spaceId ? { spaceId } : {}),
        ...(jobId ? { jobId } : {}),
        includeHistory: args.includeHistory,
        limit: args.limit,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('data-db.migration-status', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    if (result.total === 0) {
      yield* output.empty(
        'data-db.migration-status',
        input,
        jobId
          ? 'No migration job matched the requested job ID.'
          : 'No active migration jobs matched the filters.'
      );
      return;
    }

    yield* output.success('data-db.migration-status', input, result);
  });

export const dataDbMigrationStatus = Command.make(
  'migration-status',
  {
    connection: connectionOption,
    spaceId: spaceIdOptionalOption,
    jobId: jobIdOption,
    includeHistory: includeHistoryOption,
    limit: limitOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Show per-space BYODB data database migration phase, progress, validation, and rollback status'
  )
);
