#!/usr/bin/env tsx
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Teable V2 Debug Data CLI
 *
 * This CLI uses the built version of packages to avoid issues with decorators
 * and experimental TypeScript features that tsx cannot handle directly.
 */

import { DependencyContainer } from '@teable/v2-di';

const args = process.argv.slice(2);

const printUsage = (): void => {
  console.log(`Teable V2 Debug Data CLI

Usage:
  pnpm --filter @teable/v2-debug-data cli <command> [subcommand] [options]

Commands:

  underlying <subcommand>     Query underlying database data (table_meta, field tables)
    table                     Get table metadata
      --table-id <id>         Required: Table ID
    tables                    List tables in a base
      --base-id <id>          Required: Base ID
    field                     Get field metadata (includes parsed options/meta JSON)
      --field-id <id>         Required: Field ID
    fields                    List fields in a table
      --table-id <id>         Required: Table ID

  relations                   Query field dependency graph
    --field-id <id>           Required: Starting field ID
    --direction <dir>         Optional: up | down | both (default: both)
    --level <n>               Optional: Max depth (default: unlimited)
    --same-table              Optional: Only traverse same-table relations

  explain <subcommand>        Explain command execution plan (computed field updates)
    create                    Explain CreateRecord command
      --table-id <id>         Required: Table ID
      --fields <json>         Optional: JSON object of field values (default: {})
      --analyze               Optional: Run EXPLAIN ANALYZE (default: false)
    update                    Explain UpdateRecord command
      --table-id <id>         Required: Table ID
      --record-id <id>        Required: Record ID
      --fields <json>         Required: JSON object of field values to update
      --analyze               Optional: Run EXPLAIN ANALYZE (default: false)
    delete                    Explain DeleteRecords command
      --table-id <id>         Required: Table ID
      --record-ids <ids>      Required: Comma-separated record IDs
      --analyze               Optional: Run EXPLAIN ANALYZE (default: false)

Global Options:
  --connection <dsn>          Override DATABASE_URL/PRISMA_DATABASE_URL
  --help                      Show this help message

Examples:
  # View underlying field configuration (diagnose formula/lookup issues)
  pnpm --filter @teable/v2-debug-data cli underlying field --field-id fld...

  # View field dependencies (diagnose computed field propagation)
  pnpm --filter @teable/v2-debug-data cli relations --field-id fld... --direction up --level 2

  # Explain CreateRecord command (see computed update plan)
  pnpm --filter @teable/v2-debug-data cli explain create --table-id tbl...

  # Explain UpdateRecord with specific fields
  pnpm --filter @teable/v2-debug-data cli explain update --table-id tbl... --record-id rec... --fields '{"Name":"test"}'
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

// Dynamic imports to use built packages
const run = async (): Promise<void> => {
  // Import built packages
  const { encode } = await import('@toon-format/toon');
  const { registerV2DebugData, v2DebugDataTokens } = await import('@teable/v2-debug-data');
  const { createV2NodePgContainer } = await import('@teable/v2-container-node');

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
          tags?: string[];
          details?: Record<string, unknown>;
        };
      };

  const serializeError = (
    error: unknown
  ): { message: string; code?: string; tags?: string[]; details?: Record<string, unknown> } => {
    if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>;
      const message = typeof e.message === 'string' ? e.message : String(error);
      return {
        message,
        code: typeof e.code === 'string' ? e.code : undefined,
        tags: Array.isArray(e.tags) ? e.tags : undefined,
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

  const createEmptyDataOutput = (
    cmd: string,
    input: Record<string, unknown>,
    hint: string
  ): CliOutput<never> => ({
    ok: false,
    command: cmd,
    input,
    error: {
      message: `No data found. ${hint}`,
      code: 'EMPTY_RESULT',
    },
  });

  const isEmptyData = (data: unknown): boolean => {
    if (data === null || data === undefined) return true;
    if (Array.isArray(data) && data.length === 0) return true;
    return false;
  };

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

  // Initialize container
  let container: DependencyContainer;
  try {
    container = await createV2NodePgContainer({ connectionString });
    registerV2DebugData(container);
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

  const debugService = container.resolve(v2DebugDataTokens.debugDataService);

  // Route to appropriate command handler
  if (command === 'underlying') {
    const subcommand = args[1];
    if (!subcommand) {
      printOutput(createErrorOutput('underlying', {}, { message: 'Missing subcommand' }));
      process.exitCode = 1;
      return;
    }

    if (subcommand === 'table') {
      const tableId = readOption('table-id');
      if (!tableId) {
        printOutput(createErrorOutput('underlying.table', {}, { message: 'Missing --table-id' }));
        process.exitCode = 1;
        return;
      }
      const result = await debugService.getTableMeta(tableId);
      if (result.isErr()) {
        printOutput(createErrorOutput('underlying.table', { tableId }, result.error));
        process.exitCode = 1;
        return;
      }
      if (isEmptyData(result.value)) {
        printOutput(
          createEmptyDataOutput(
            'underlying.table',
            { tableId },
            `Table "${tableId}" not found. Check if the table ID is correct and exists in the database.`
          )
        );
        process.exitCode = 1;
        return;
      }
      printOutput(createSuccessOutput('underlying.table', { tableId }, result.value));
      return;
    }

    if (subcommand === 'tables') {
      const baseId = readOption('base-id');
      if (!baseId) {
        printOutput(createErrorOutput('underlying.tables', {}, { message: 'Missing --base-id' }));
        process.exitCode = 1;
        return;
      }
      const result = await debugService.getTablesByBaseId(baseId);
      if (result.isErr()) {
        printOutput(createErrorOutput('underlying.tables', { baseId }, result.error));
        process.exitCode = 1;
        return;
      }
      if (isEmptyData(result.value)) {
        printOutput(
          createEmptyDataOutput(
            'underlying.tables',
            { baseId },
            `No tables found in base "${baseId}". Check if the base ID is correct or if the base has any tables.`
          )
        );
        process.exitCode = 1;
        return;
      }
      printOutput(createSuccessOutput('underlying.tables', { baseId }, result.value));
      return;
    }

    if (subcommand === 'field') {
      const fieldId = readOption('field-id');
      if (!fieldId) {
        printOutput(createErrorOutput('underlying.field', {}, { message: 'Missing --field-id' }));
        process.exitCode = 1;
        return;
      }
      const result = await debugService.getField(fieldId);
      if (result.isErr()) {
        printOutput(createErrorOutput('underlying.field', { fieldId }, result.error));
        process.exitCode = 1;
        return;
      }
      if (isEmptyData(result.value)) {
        printOutput(
          createEmptyDataOutput(
            'underlying.field',
            { fieldId },
            `Field "${fieldId}" not found. Check if the field ID is correct and exists in the database.`
          )
        );
        process.exitCode = 1;
        return;
      }
      printOutput(createSuccessOutput('underlying.field', { fieldId }, result.value));
      return;
    }

    if (subcommand === 'fields') {
      const tableId = readOption('table-id');
      if (!tableId) {
        printOutput(createErrorOutput('underlying.fields', {}, { message: 'Missing --table-id' }));
        process.exitCode = 1;
        return;
      }
      const result = await debugService.getFieldsByTableId(tableId);
      if (result.isErr()) {
        printOutput(createErrorOutput('underlying.fields', { tableId }, result.error));
        process.exitCode = 1;
        return;
      }
      if (isEmptyData(result.value)) {
        printOutput(
          createEmptyDataOutput(
            'underlying.fields',
            { tableId },
            `No fields found for table "${tableId}". Check if the table ID is correct or if the table has any fields.`
          )
        );
        process.exitCode = 1;
        return;
      }
      printOutput(createSuccessOutput('underlying.fields', { tableId }, result.value));
      return;
    }

    printOutput(
      createErrorOutput(
        'underlying',
        { subcommand },
        { message: `Unknown subcommand: ${subcommand}` }
      )
    );
    process.exitCode = 1;
    return;
  }

  if (command === 'relations') {
    const fieldId = readOption('field-id');
    if (!fieldId) {
      printOutput(createErrorOutput('relations', {}, { message: 'Missing --field-id' }));
      process.exitCode = 1;
      return;
    }

    const direction = (readOption('direction') ?? 'both') as 'up' | 'down' | 'both';
    const level = readNumberOption('level');
    const sameTable = hasFlag('same-table');

    const input = {
      fieldId,
      direction,
      maxDepth: level ?? null,
      sameTableOnly: sameTable,
    };

    const result = await debugService.getFieldRelationReport(fieldId, {
      direction,
      maxDepth: level ?? null,
      sameTableOnly: sameTable,
    });

    if (result.isErr()) {
      const errorMsg = result.error.message;
      // Check if it's a "field not found" type error
      if (errorMsg.includes('not found') || errorMsg.includes('Not found')) {
        printOutput(
          createEmptyDataOutput(
            'relations',
            input,
            `Field "${fieldId}" not found. Check if the field ID is correct and exists in the database.`
          )
        );
      } else {
        printOutput(createErrorOutput('relations', input, result.error));
      }
      process.exitCode = 1;
      return;
    }

    printOutput(createSuccessOutput('relations', input, result.value));
    return;
  }

  if (command === 'explain') {
    const subcommand = args[1];
    if (!subcommand) {
      printOutput(
        createErrorOutput('explain', {}, { message: 'Missing subcommand (create/update/delete)' })
      );
      process.exitCode = 1;
      return;
    }

    // Import explain-related packages
    const { registerCommandExplainModule, v2CommandExplainTokens } = await import(
      '@teable/v2-command-explain'
    );
    const { CreateRecordCommand, UpdateRecordCommand, DeleteRecordsCommand, RecordId } =
      await import('@teable/v2-core');

    // Register command-explain module
    registerCommandExplainModule(container);
    const explainService = container.resolve(v2CommandExplainTokens.explainService);

    // Create execution context
    const context = {
      userId: 'cli-debug',
      requestId: `cli-${Date.now()}`,
    };

    const analyze = hasFlag('analyze');
    const fieldsJson = readOption('fields');

    if (subcommand === 'create') {
      const tableId = readOption('table-id');
      if (!tableId) {
        printOutput(createErrorOutput('explain.create', {}, { message: 'Missing --table-id' }));
        process.exitCode = 1;
        return;
      }

      let fields: Record<string, unknown> = {};
      if (fieldsJson) {
        try {
          fields = JSON.parse(fieldsJson) as Record<string, unknown>;
        } catch {
          printOutput(
            createErrorOutput(
              'explain.create',
              { tableId },
              { message: 'Invalid JSON in --fields' }
            )
          );
          process.exitCode = 1;
          return;
        }
      }

      const input = { tableId, fields, analyze };

      const commandResult = CreateRecordCommand.create({ tableId, fields });
      if (commandResult.isErr()) {
        printOutput(createErrorOutput('explain.create', input, commandResult.error));
        process.exitCode = 1;
        return;
      }

      const result = await explainService.explain(context, commandResult.value, {
        analyze,
        includeSql: true,
        includeGraph: false,
        includeLocks: true,
      });

      if (result.isErr()) {
        printOutput(createErrorOutput('explain.create', input, result.error));
        process.exitCode = 1;
        return;
      }

      printOutput(createSuccessOutput('explain.create', input, result.value));
      return;
    }

    if (subcommand === 'update') {
      const tableId = readOption('table-id');
      const recordId = readOption('record-id');

      if (!tableId) {
        printOutput(createErrorOutput('explain.update', {}, { message: 'Missing --table-id' }));
        process.exitCode = 1;
        return;
      }
      if (!recordId) {
        printOutput(
          createErrorOutput('explain.update', { tableId }, { message: 'Missing --record-id' })
        );
        process.exitCode = 1;
        return;
      }
      if (!fieldsJson) {
        printOutput(
          createErrorOutput(
            'explain.update',
            { tableId, recordId },
            { message: 'Missing --fields' }
          )
        );
        process.exitCode = 1;
        return;
      }

      let fields: Record<string, unknown>;
      try {
        fields = JSON.parse(fieldsJson) as Record<string, unknown>;
      } catch {
        printOutput(
          createErrorOutput(
            'explain.update',
            { tableId, recordId },
            { message: 'Invalid JSON in --fields' }
          )
        );
        process.exitCode = 1;
        return;
      }

      const input = { tableId, recordId, fields, analyze };

      const commandResult = UpdateRecordCommand.create({ tableId, recordId, fields });
      if (commandResult.isErr()) {
        printOutput(createErrorOutput('explain.update', input, commandResult.error));
        process.exitCode = 1;
        return;
      }

      const result = await explainService.explain(context, commandResult.value, {
        analyze,
        includeSql: true,
        includeGraph: false,
        includeLocks: true,
      });

      if (result.isErr()) {
        printOutput(createErrorOutput('explain.update', input, result.error));
        process.exitCode = 1;
        return;
      }

      printOutput(createSuccessOutput('explain.update', input, result.value));
      return;
    }

    if (subcommand === 'delete') {
      const tableId = readOption('table-id');
      const recordIdsStr = readOption('record-ids');

      if (!tableId) {
        printOutput(createErrorOutput('explain.delete', {}, { message: 'Missing --table-id' }));
        process.exitCode = 1;
        return;
      }
      if (!recordIdsStr) {
        printOutput(
          createErrorOutput('explain.delete', { tableId }, { message: 'Missing --record-ids' })
        );
        process.exitCode = 1;
        return;
      }

      const recordIds = recordIdsStr.split(',').map((id) => id.trim());

      // Validate record IDs
      for (const id of recordIds) {
        const recordIdResult = RecordId.create(id);
        if (recordIdResult.isErr()) {
          printOutput(
            createErrorOutput(
              'explain.delete',
              { tableId, recordIds },
              { message: `Invalid record ID: ${id}` }
            )
          );
          process.exitCode = 1;
          return;
        }
      }

      const input = { tableId, recordIds, analyze };

      const commandResult = DeleteRecordsCommand.create({ tableId, recordIds });
      if (commandResult.isErr()) {
        printOutput(createErrorOutput('explain.delete', input, commandResult.error));
        process.exitCode = 1;
        return;
      }

      const result = await explainService.explain(context, commandResult.value, {
        analyze,
        includeSql: true,
        includeGraph: false,
        includeLocks: true,
      });

      if (result.isErr()) {
        printOutput(createErrorOutput('explain.delete', input, result.error));
        process.exitCode = 1;
        return;
      }

      printOutput(createSuccessOutput('explain.delete', input, result.value));
      return;
    }

    printOutput(
      createErrorOutput(
        'explain',
        { subcommand },
        { message: `Unknown subcommand: ${subcommand}. Use create, update, or delete.` }
      )
    );
    process.exitCode = 1;
    return;
  }

  printOutput(createErrorOutput('cli', { command }, { message: `Unknown command: ${command}` }));
  process.exitCode = 1;
};

run().catch((error) => {
  console.error('CLI error:', error);
  process.exitCode = 1;
});
