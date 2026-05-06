import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  createSchemaRepairer,
  PostgresSchemaIntrospector,
  type SchemaRepairResult,
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
  SchemaRepairer,
  type SchemaRepairOptions,
  type SchemaRepairSummary,
} from '../services/SchemaRepairer';

const summarizeRepairResults = (
  results: ReadonlyArray<SchemaRepairResult>
): Omit<SchemaRepairSummary, 'results'> => {
  let repaired = 0;
  let unchanged = 0;
  let manual = 0;
  let skipped = 0;
  let errors = 0;

  for (const result of results) {
    if (result.status === 'error') {
      errors++;
      continue;
    }

    if (result.status === 'skipped') {
      skipped++;
      continue;
    }

    if (result.outcome === 'repaired') {
      repaired++;
    } else if (result.outcome === 'unchanged') {
      unchanged++;
    } else if (result.outcome === 'manual') {
      manual++;
    }
  }

  return {
    total: results.length,
    repaired,
    unchanged,
    manual,
    skipped,
    errors,
  };
};

export const SchemaRepairerLive = Layer.effect(
  SchemaRepairer,
  Effect.gen(function* () {
    const { container } = yield* Database;

    const loadTable = async (tableId: string) => {
      const tableRepo = container.resolve(v2CoreTokens.tableRepository) as ITableRepository;
      const actorIdResult = ActorId.create('cli-schema-repairer');
      if (actorIdResult.isErr()) throw actorIdResult.error;
      const context = { actorId: actorIdResult.value };

      const tableIdResult = TableId.create(tableId);
      if (tableIdResult.isErr()) throw tableIdResult.error;

      const tableSpec = TableByIdSpec.create(tableIdResult.value);
      const tableResult = await tableRepo.findOne(context, tableSpec);
      if (tableResult.isErr()) throw tableResult.error;
      const table = tableResult.value;
      if (!table) throw new Error(`Table "${tableId}" not found`);

      return table;
    };

    const executeRepair = async (
      tableId: string,
      runner: (
        repairer: ReturnType<typeof createSchemaRepairer>,
        table: Awaited<ReturnType<typeof loadTable>>
      ) => AsyncGenerator<SchemaRepairResult, void, unknown>
    ): Promise<SchemaRepairSummary> => {
      const table = await loadTable(tableId);
      const schema = table.baseId().toString();
      const db = container.resolve(v2DataDbTokens.db) as Kysely<V1TeableDatabase>;
      const introspector = new PostgresSchemaIntrospector(db);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema,
      });

      const results: SchemaRepairResult[] = [];
      for await (const result of runner(repairer, table)) {
        if (result.status === 'pending' || result.status === 'running') {
          continue;
        }

        results.push(result);
      }

      return {
        ...summarizeRepairResults(results),
        results,
      };
    };

    return {
      repairTable: (
        tableId: string,
        options?: SchemaRepairOptions
      ): Effect.Effect<SchemaRepairSummary, CliError> =>
        Effect.tryPromise({
          try: async () =>
            executeRepair(tableId, (repairer, table) => repairer.repairTable(table, options)),
          catch: (e) => CliError.fromUnknown(e),
        }),

      repairField: (
        tableId: string,
        fieldId: string,
        options?: SchemaRepairOptions
      ): Effect.Effect<SchemaRepairSummary, CliError> =>
        Effect.tryPromise({
          try: async () =>
            executeRepair(tableId, (repairer, table) =>
              repairer.repairField(table, fieldId, options)
            ),
          catch: (e) => CliError.fromUnknown(e),
        }),

      repairRule: (
        tableId: string,
        fieldId: string,
        ruleId: string,
        options?: SchemaRepairOptions
      ): Effect.Effect<SchemaRepairSummary, CliError> =>
        Effect.tryPromise({
          try: async () =>
            executeRepair(tableId, (repairer, table) =>
              repairer.repairRule(table, fieldId, ruleId, options)
            ),
          catch: (e) => CliError.fromUnknown(e),
        }),
    };
  })
);
