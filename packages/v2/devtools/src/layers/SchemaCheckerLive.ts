import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  createSchemaChecker,
  PostgresSchemaIntrospector,
  type SchemaCheckResult,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  ActorId,
  v2CoreTokens,
  TableId,
  TableByIdSpec,
  type ITableRepository,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Effect, Layer } from 'effect';
import type { Kysely } from 'kysely';
import { CliError } from '../errors/CliError';
import { Database } from '../services/Database';
import {
  SchemaChecker,
  type SchemaCheckOptions,
  type SchemaCheckSummary,
} from '../services/SchemaChecker';

export const SchemaCheckerLive = Layer.effect(
  SchemaChecker,
  Effect.gen(function* () {
    const { container } = yield* Database;

    return {
      checkTable: (
        tableId: string,
        options?: SchemaCheckOptions
      ): Effect.Effect<SchemaCheckSummary, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const tableRepo = container.resolve(v2CoreTokens.tableRepository) as ITableRepository;
            const db = container.resolve(v2PostgresDbTokens.db) as Kysely<V1TeableDatabase>;
            const actorIdResult = ActorId.create('cli-schema-checker');
            if (actorIdResult.isErr()) throw actorIdResult.error;
            const context = { actorId: actorIdResult.value };

            // Load table
            const tableIdResult = TableId.create(tableId);
            if (tableIdResult.isErr()) throw tableIdResult.error;
            const tableSpec = TableByIdSpec.create(tableIdResult.value);
            const tableResult = await tableRepo.findOne(context, tableSpec);
            if (tableResult.isErr()) throw tableResult.error;
            const table = tableResult.value;
            if (!table) throw new Error(`Table "${tableId}" not found`);

            // Create schema checker
            const introspector = new PostgresSchemaIntrospector(db);
            const checker = createSchemaChecker({
              db,
              introspector,
              schema: 'public',
            });

            // Collect results
            const results: SchemaCheckResult[] = [];
            let success = 0;
            let errors = 0;
            let warnings = 0;

            for await (const result of checker.checkTable(table)) {
              // Skip running/pending status, only count final results
              if (result.status === 'running' || result.status === 'pending') {
                continue;
              }

              if (result.status === 'success') {
                success++;
                if (!options?.errorsOnly) {
                  results.push(result);
                }
              } else if (result.status === 'error') {
                errors++;
                results.push(result);
              } else if (result.status === 'warn') {
                warnings++;
                results.push(result);
              }
            }

            return {
              total: success + errors + warnings,
              success,
              errors,
              warnings,
              results,
            };
          },
          catch: (e) => CliError.fromUnknown(e),
        }),

      checkField: (
        tableId: string,
        fieldId: string,
        options?: SchemaCheckOptions
      ): Effect.Effect<SchemaCheckSummary, CliError> =>
        Effect.tryPromise({
          try: async () => {
            const tableRepo = container.resolve(v2CoreTokens.tableRepository) as ITableRepository;
            const db = container.resolve(v2PostgresDbTokens.db) as Kysely<V1TeableDatabase>;
            const actorIdResult = ActorId.create('cli-schema-checker');
            if (actorIdResult.isErr()) throw actorIdResult.error;
            const context = { actorId: actorIdResult.value };

            // Load table
            const tableIdResult = TableId.create(tableId);
            if (tableIdResult.isErr()) throw tableIdResult.error;
            const tableSpec = TableByIdSpec.create(tableIdResult.value);
            const tableResult = await tableRepo.findOne(context, tableSpec);
            if (tableResult.isErr()) throw tableResult.error;
            const table = tableResult.value;
            if (!table) throw new Error(`Table "${tableId}" not found`);

            // Create schema checker
            const introspector = new PostgresSchemaIntrospector(db);
            const checker = createSchemaChecker({
              db,
              introspector,
              schema: 'public',
            });

            // Collect results
            const results: SchemaCheckResult[] = [];
            let success = 0;
            let errors = 0;
            let warnings = 0;

            for await (const result of checker.checkField(table, fieldId)) {
              // Skip running/pending status
              if (result.status === 'running' || result.status === 'pending') {
                continue;
              }

              if (result.status === 'success') {
                success++;
                if (!options?.errorsOnly) {
                  results.push(result);
                }
              } else if (result.status === 'error') {
                errors++;
                results.push(result);
              } else if (result.status === 'warn') {
                warnings++;
                results.push(result);
              }
            }

            return {
              total: success + errors + warnings,
              success,
              errors,
              warnings,
              results,
            };
          },
          catch: (e) => CliError.fromUnknown(e),
        }),
    };
  })
);
