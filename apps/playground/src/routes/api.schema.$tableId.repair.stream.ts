import { createFileRoute } from '@tanstack/react-router';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  createSchemaRepairer,
  errorResult,
  pendingResult,
  PostgresSchemaIntrospector,
  type SchemaRepairResult,
} from '@teable/v2-adapter-table-repository-postgres';
import { ActorId, TableByIdSpec, TableId, v2CoreTokens } from '@teable/v2-core';
import type { IExecutionContext, ITableRepository } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import { PLAYGROUND_ACTOR_ID } from '@/lib/playground/constants';
import { PLAYGROUND_DB_URL_QUERY_PARAM } from '@/lib/playground/databaseUrl';
import { createPlaygroundContainer } from '@/server/playgroundContainer';
import { v2Tracer } from '@/server/otel';

const formatSSEMessage = (result: SchemaRepairResult): string => {
  return `data: ${JSON.stringify(result)}\n\n`;
};

const parseBoolean = (value: string | null): boolean =>
  value === '1' || value === 'true' || value === 'yes';

const createErrorResult = (
  id: string,
  ruleId: string,
  ruleDescription: string,
  message: string
): SchemaRepairResult => {
  return {
    ...errorResult(pendingResult('', '', ruleId, ruleDescription, true), message),
    id,
  };
};

const createLifecycleResult = (
  id: 'connect' | 'complete',
  ruleId: 'connection' | 'completion',
  message: string
): SchemaRepairResult => {
  return {
    ...pendingResult('', '', ruleId, ruleId === 'connection' ? 'Connection' : 'Completion', true),
    id,
    status: 'success',
    outcome: 'unchanged',
    message,
    timestamp: Date.now(),
  };
};

async function handleSSE({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string>;
}) {
  const { tableId: tableIdStr } = params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const url = new URL(request.url);
        const connectionString =
          url.searchParams.get(PLAYGROUND_DB_URL_QUERY_PARAM)?.trim() || undefined;
        const fieldId = url.searchParams.get('fieldId')?.trim() || undefined;
        const ruleId = url.searchParams.get('ruleId')?.trim() || undefined;
        const dryRun = parseBoolean(url.searchParams.get('dryRun'));
        const container = await createPlaygroundContainer({ connectionString });

        const tableIdResult = TableId.create(tableIdStr);
        if (tableIdResult.isErr()) {
          controller.enqueue(
            encoder.encode(
              formatSSEMessage(
                createErrorResult(
                  'error:invalid_table_id',
                  'table_lookup',
                  'Table lookup',
                  `Invalid table ID: ${tableIdResult.error}`
                )
              )
            )
          );
          controller.close();
          return;
        }

        const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
        const actorIdResult = ActorId.create(PLAYGROUND_ACTOR_ID);
        if (actorIdResult.isErr()) {
          controller.enqueue(
            encoder.encode(
              formatSSEMessage(
                createErrorResult(
                  'error:actor_id',
                  'actor_id',
                  'Actor ID',
                  `Invalid actor ID: ${actorIdResult.error}`
                )
              )
            )
          );
          controller.close();
          return;
        }

        const context: IExecutionContext = {
          actorId: actorIdResult.value,
          tracer: v2Tracer,
        };

        const tableResult = await tableRepository.findOne(
          context,
          TableByIdSpec.create(tableIdResult.value)
        );
        if (tableResult.isErr()) {
          controller.enqueue(
            encoder.encode(
              formatSSEMessage(
                createErrorResult(
                  'error:table_not_found',
                  'table_lookup',
                  'Table lookup',
                  `Table not found: ${tableResult.error.message}`
                )
              )
            )
          );
          controller.close();
          return;
        }

        const table = tableResult.value;
        const connectResult = createLifecycleResult(
          'connect',
          'connection',
          `Schema repair stream connected for table: ${table.name().toString()}`
        );
        controller.enqueue(encoder.encode(formatSSEMessage(connectResult)));

        const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
        const introspector = new PostgresSchemaIntrospector(db);
        const repairer = createSchemaRepairer({
          db,
          introspector,
          schema: table.baseId().toString(),
        });

        const generator =
          fieldId && ruleId
            ? repairer.repairRule(table, fieldId, ruleId, { dryRun })
            : fieldId
              ? repairer.repairField(table, fieldId, { dryRun })
              : repairer.repairTable(table, { dryRun });

        for await (const result of generator) {
          if (request.signal.aborted) {
            break;
          }

          controller.enqueue(encoder.encode(formatSSEMessage(result)));
        }

        const completeResult = createLifecycleResult(
          'complete',
          'completion',
          'Schema repair completed'
        );
        controller.enqueue(encoder.encode(formatSSEMessage(completeResult)));
        controller.close();
      } catch (error) {
        const errorResult = createErrorResult(
          'error:unexpected',
          'unexpected',
          'Unexpected error',
          error instanceof Error ? error.message : 'Unknown error'
        );
        controller.enqueue(encoder.encode(formatSSEMessage(errorResult)));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export const Route = createFileRoute('/api/schema/$tableId/repair/stream')({
  server: {
    handlers: {
      GET: handleSSE,
    },
  },
});
