#!/usr/bin/env tsx
/* eslint-disable regexp/no-unused-capturing-group */
/* eslint-disable no-inner-declarations */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Teable V2 Mock Records CLI
 *
 * Generates mock data for tables using faker.
 * SECURITY: Only works with localhost PostgreSQL connections.
 */

import type { ITableRepository, ITableRecordRepository } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

const args = process.argv.slice(2);

const printUsage = (): void => {
  console.log(`Teable V2 Mock Records CLI

Usage:
  pnpm --filter @teable/v2-mock-records cli <command> [options]

Commands:

  generate                    Generate mock records for a table
    --table-id <id>           Required: Table ID to generate records for
    --count <n>               Required: Number of records to generate
    --seed <n>                Optional: Seed for reproducible random data
    --batch-size <n>          Optional: Batch size for insertion (default: 100)
    --dry-run                 Optional: Only show what would be generated, don't insert

Global Options:
  --connection <dsn>          Override DATABASE_URL/PRISMA_DATABASE_URL
  --help                      Show this help message

Examples:
  # Generate 100 mock records
  pnpm --filter @teable/v2-mock-records cli generate --table-id tbl... --count 100

  # Generate with reproducible seed
  pnpm --filter @teable/v2-mock-records cli generate --table-id tbl... --count 50 --seed 12345

  # Dry run (preview without inserting)
  pnpm --filter @teable/v2-mock-records cli generate --table-id tbl... --count 10 --dry-run

SECURITY NOTE:
  This CLI only works with localhost PostgreSQL connections (127.0.0.1 or localhost).
  Remote database connections are blocked for safety.
`);
};

const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);

const readOption = (name: string): string | null => {
  const dashed = `--${name}`;
  const direct = args.find((arg) => arg.startsWith(`${dashed}=`));
  if (direct) return direct.split('=').slice(1).join('=');
  const index = args.indexOf(dashed);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const readNumberOption = (name: string): number | undefined => {
  const value = readOption(name);
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const command = args[0];

if (!command || hasFlag('help')) {
  printUsage();
  process.exit(0);
}

const DEFAULT_CONNECTION_STRING = 'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public';

const connectionString =
  readOption('connection') ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL ??
  DEFAULT_CONNECTION_STRING;

/**
 * Check if connection string is localhost only
 */
const isLocalhostConnection = (connStr: string): boolean => {
  try {
    const url = new URL(connStr);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('127.')
    );
  } catch {
    // If URL parsing fails, try regex match
    return /(@localhost|@127\.0\.0\.1|@::1|@127\.)/.test(connStr);
  }
};

// Dynamic imports to use built packages
const run = async (): Promise<void> => {
  // Import built packages
  const { encode } = await import('@toon-format/toon');
  const { createV2NodePgContainer } = await import('@teable/v2-container-node');
  const { v2CoreTokens, TableId, TableByIdSpec, ActorId } = await import('@teable/v2-core');
  const { MockRecordGenerator } = await import('../src/index');

  type CliOutput<T> =
    | {
        ok: true;
        command: string;
        input: Record<string, unknown>;
        data: T;
      }
    | {
        ok: false;
        command: string;
        input: Record<string, unknown>;
        error: {
          message: string;
          code?: string;
          details?: Record<string, unknown>;
        };
      };

  const serializeError = (
    error: unknown
  ): { message: string; code?: string; details?: Record<string, unknown> } => {
    if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>;
      const message = typeof e.message === 'string' ? e.message : String(error);
      return {
        message,
        code: typeof e.code === 'string' ? e.code : undefined,
        details:
          typeof e.details === 'object' && e.details !== null
            ? (e.details as Record<string, unknown>)
            : undefined,
      };
    }
    return { message: String(error) };
  };

  const printOutput = <T>(output: CliOutput<T>): void => {
    console.log(encode(output));
  };

  const createSuccessOutput = <T>(
    cmd: string,
    input: Record<string, unknown>,
    data: T
  ): CliOutput<T> => ({
    ok: true,
    command: cmd,
    input,
    data,
  });

  const createErrorOutput = (
    cmd: string,
    input: Record<string, unknown>,
    error: unknown
  ): CliOutput<never> => ({
    ok: false,
    command: cmd,
    input,
    error: serializeError(error),
  });

  // Security check: only allow localhost connections
  if (!isLocalhostConnection(connectionString)) {
    printOutput(
      createErrorOutput(
        'security',
        {},
        {
          message: 'Remote database connections are not allowed for mock data generation.',
          code: 'REMOTE_CONNECTION_BLOCKED',
          details: {
            hint: 'This CLI only works with localhost PostgreSQL connections (127.0.0.1 or localhost) for safety.',
          },
        }
      )
    );
    process.exitCode = 1;
    return;
  }

  // Initialize container
  let container: DependencyContainer;
  try {
    container = await createV2NodePgContainer({ connectionString });
  } catch (error) {
    printOutput(
      createErrorOutput(
        'init',
        { connectionString: connectionString ? '<provided>' : '<env>' },
        error
      )
    );
    process.exitCode = 1;
    return;
  }

  const tableRepository = container.resolve(v2CoreTokens.tableRepository) as ITableRepository;
  const tableRecordRepository = container.resolve(
    v2CoreTokens.tableRecordRepository
  ) as ITableRecordRepository;

  // Route to appropriate command handler
  if (command === 'generate') {
    const tableIdStr = readOption('table-id');
    const count = readNumberOption('count');
    const seed = readNumberOption('seed');
    const batchSize = readNumberOption('batch-size') ?? 100;
    const dryRun = hasFlag('dry-run');

    if (!tableIdStr) {
      printOutput(createErrorOutput('generate', {}, { message: 'Missing --table-id' }));
      process.exitCode = 1;
      return;
    }

    if (count === undefined || count <= 0) {
      printOutput(
        createErrorOutput(
          'generate',
          { tableId: tableIdStr },
          { message: 'Missing or invalid --count (must be > 0)' }
        )
      );
      process.exitCode = 1;
      return;
    }

    const input = { tableId: tableIdStr, count, seed, batchSize, dryRun };

    // Parse table ID
    const tableIdResult = TableId.create(tableIdStr);
    if (tableIdResult.isErr()) {
      printOutput(createErrorOutput('generate', input, tableIdResult.error));
      process.exitCode = 1;
      return;
    }
    const tableId = tableIdResult.value;

    // Create execution context
    const actorIdResult = ActorId.create('cli-mock-records');
    if (actorIdResult.isErr()) {
      printOutput(createErrorOutput('generate', input, actorIdResult.error));
      process.exitCode = 1;
      return;
    }
    const context = {
      actorId: actorIdResult.value,
    };

    // Load table
    const tableResult = await tableRepository.findOne(context, TableByIdSpec.create(tableId));
    if (tableResult.isErr()) {
      printOutput(createErrorOutput('generate', input, tableResult.error));
      process.exitCode = 1;
      return;
    }

    const table = tableResult.value;
    if (!table) {
      printOutput(
        createErrorOutput('generate', input, {
          message: `Table "${tableIdStr}" not found`,
          code: 'TABLE_NOT_FOUND',
        })
      );
      process.exitCode = 1;
      return;
    }

    // Create generator
    const generator = MockRecordGenerator.create({
      count,
      seed,
      batchSize,
    });

    // Generate records
    const sampleRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];

    try {
      if (dryRun) {
        // Dry run: collect samples without inserting
        let totalGenerated = 0;
        for await (const batch of generator.generateForTable(table)) {
          totalGenerated += batch.length;
          // Collect first 5 records as sample
          for (const record of batch) {
            if (sampleRecords.length < 5) {
              const fields: Record<string, unknown> = {};
              for (const entry of record.fields().entries()) {
                fields[entry.fieldId.toString()] = entry.value.toValue();
              }
              sampleRecords.push({
                id: record.id().toString(),
                fields,
              });
            }
          }
        }

        const summary = {
          tableId: tableIdStr,
          tableName: table.name().toString(),
          totalGenerated,
          totalInserted: 0,
          dryRun: true,
          seed: seed ?? null,
          sampleRecords,
        };

        printOutput(createSuccessOutput('generate', input, summary));
        return;
      }

      // Actual insert using insertManyStream
      // We need to create a generator that also collects samples
      async function* generateWithSamples() {
        for await (const batch of generator.generateForTable(table)) {
          // Collect first 5 records as sample
          for (const record of batch) {
            if (sampleRecords.length < 5) {
              const fields: Record<string, unknown> = {};
              for (const entry of record.fields().entries()) {
                fields[entry.fieldId.toString()] = entry.value.toValue();
              }
              sampleRecords.push({
                id: record.id().toString(),
                fields,
              });
            }
          }
          yield batch;
        }
      }

      const insertResult = await tableRecordRepository.insertManyStream(
        context,
        table,
        generateWithSamples()
      );

      if (insertResult.isErr()) {
        printOutput(
          createErrorOutput('generate', input, {
            message: `Failed to insert records: ${insertResult.error.message}`,
            code: 'INSERT_FAILED',
          })
        );
        process.exitCode = 1;
        return;
      }

      const { totalInserted } = insertResult.value;

      const summary = {
        tableId: tableIdStr,
        tableName: table.name().toString(),
        totalGenerated: totalInserted,
        totalInserted,
        dryRun: false,
        seed: seed ?? null,
        sampleRecords,
      };

      printOutput(createSuccessOutput('generate', input, summary));
      return;
    } catch (error) {
      printOutput(createErrorOutput('generate', input, error));
      process.exitCode = 1;
      return;
    }
  }

  printOutput(createErrorOutput('cli', { command }, { message: `Unknown command: ${command}` }));
  process.exitCode = 1;
};

run().catch((error) => {
  console.error('CLI error:', error);
  process.exitCode = 1;
});
