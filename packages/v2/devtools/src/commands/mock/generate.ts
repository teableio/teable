import { Command, Options } from '@effect/cli';
import { Effect, Option } from 'effect';
import { MockRecords } from '../../services/MockRecords';
import { Output } from '../../services/Output';
import { DatabaseConfig } from '../../services/Database';
import { SecurityError, ValidationError } from '../../errors/CliError';
import { connectionOption, tableIdOption } from '../shared';
import { isLocalhostConnection } from '../../utils/localhost-check';

const countOption = Options.integer('count').pipe(
  Options.withDescription('Number of records to generate')
);

const seedOption = Options.integer('seed').pipe(
  Options.withDescription('Seed for reproducible random data'),
  Options.optional
);

const batchSizeOption = Options.integer('batch-size').pipe(
  Options.withDefault(100),
  Options.withDescription('Batch size for insertion')
);

const dryRunOption = Options.boolean('dry-run').pipe(
  Options.withDefault(false),
  Options.withDescription("Only show what would be generated, don't insert")
);

const validateConnection = (connectionString: string) =>
  isLocalhostConnection(connectionString)
    ? Effect.void
    : Effect.fail(
        new SecurityError({
          message: 'Remote database connections are not allowed for mock data generation.',
          code: 'REMOTE_CONNECTION_BLOCKED',
          hint: 'This CLI only works with localhost PostgreSQL connections.',
        })
      );

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: string;
  readonly count: number;
  readonly seed: Option.Option<number>;
  readonly batchSize: number;
  readonly dryRun: boolean;
}) =>
  Effect.gen(function* () {
    const config = yield* DatabaseConfig;
    const mockRecords = yield* MockRecords;
    const output = yield* Output;

    // Security check
    yield* validateConnection(config.connectionString);

    // Validate count
    if (args.count <= 0) {
      return yield* Effect.fail(
        new ValidationError({ message: '--count must be greater than 0', field: 'count' })
      );
    }

    const seed = Option.getOrUndefined(args.seed);
    const input = {
      tableId: args.tableId,
      count: args.count,
      seed,
      batchSize: args.batchSize,
      dryRun: args.dryRun,
    };

    const result = yield* mockRecords
      .generate({
        tableId: args.tableId,
        count: args.count,
        seed,
        batchSize: args.batchSize,
        dryRun: args.dryRun,
      })
      .pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* output.error('mock.generate', input, error);
            return yield* Effect.fail(error);
          })
        )
      );

    yield* output.success('mock.generate', input, result);
  });

export const mockGenerate = Command.make(
  'generate',
  {
    connection: connectionOption,
    tableId: tableIdOption,
    count: countOption,
    seed: seedOption,
    batchSize: batchSizeOption,
    dryRun: dryRunOption,
  },
  handler
).pipe(Command.withDescription('Generate mock records for a table'));
