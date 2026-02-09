import { createFileRoute } from '@tanstack/react-router';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  createSchemaChecker,
  PostgresSchemaIntrospector,
  type SchemaCheckResult,
} from '@teable/v2-adapter-table-repository-postgres';
import { ActorId, TableByIdSpec, TableId, v2CoreTokens } from '@teable/v2-core';
import type { IExecutionContext, ITableRepository } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import { PLAYGROUND_ACTOR_ID } from '@/lib/playground/constants';
import { PLAYGROUND_DB_URL_QUERY_PARAM } from '@/lib/playground/databaseUrl';
import { createPlaygroundContainer } from '@/server/playgroundContainer';
import { v2Tracer } from '@/server/otel';

const formatSSEMessage = (result: SchemaCheckResult): string => {
  return `data: ${JSON.stringify(result)}\n\n`;
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

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Get container
        const url = new URL(request.url);
        const connectionString =
          url.searchParams.get(PLAYGROUND_DB_URL_QUERY_PARAM)?.trim() || undefined;
        const container = await createPlaygroundContainer({ connectionString });

        // Validate tableId
        const tableIdResult = TableId.create(tableIdStr);
        if (tableIdResult.isErr()) {
          const errorResult: SchemaCheckResult = {
            id: 'error:invalid_table_id',
            fieldId: '',
            fieldName: '',
            ruleId: 'table_lookup',
            ruleDescription: 'Table lookup',
            status: 'error',
            message: `Invalid table ID: ${tableIdResult.error}`,
            required: true,
            timestamp: Date.now(),
          };
          controller.enqueue(encoder.encode(formatSSEMessage(errorResult)));
          controller.close();
          return;
        }

        const tableId = tableIdResult.value;

        // Get table from repository
        const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
        const spec = TableByIdSpec.create(tableId);

        // Create execution context with real tracer
        const actorIdResult = ActorId.create(PLAYGROUND_ACTOR_ID);
        if (actorIdResult.isErr()) {
          const errorResult: SchemaCheckResult = {
            id: 'error:actor_id',
            fieldId: '',
            fieldName: '',
            ruleId: 'actor_id',
            ruleDescription: 'Actor ID',
            status: 'error',
            message: `Invalid actor ID: ${actorIdResult.error}`,
            required: true,
            timestamp: Date.now(),
          };
          controller.enqueue(encoder.encode(formatSSEMessage(errorResult)));
          controller.close();
          return;
        }

        const context: IExecutionContext = {
          actorId: actorIdResult.value,
          tracer: v2Tracer,
        };

        const tableResult = await tableRepository.findOne(context, spec);
        if (tableResult.isErr()) {
          const errorResult: SchemaCheckResult = {
            id: 'error:table_not_found',
            fieldId: '',
            fieldName: '',
            ruleId: 'table_lookup',
            ruleDescription: 'Table lookup',
            status: 'error',
            message: `Table not found: ${tableResult.error.message}`,
            required: true,
            timestamp: Date.now(),
          };
          controller.enqueue(encoder.encode(formatSSEMessage(errorResult)));
          controller.close();
          return;
        }

        const table = tableResult.value;

        // Send connection confirmation
        const connectResult: SchemaCheckResult = {
          id: 'connect',
          fieldId: '',
          fieldName: '',
          ruleId: 'connection',
          ruleDescription: 'Connection',
          status: 'success',
          message: `🔗 Schema check stream connected for table: ${table.name().toString()}`,
          required: true,
          timestamp: Date.now(),
        };
        controller.enqueue(encoder.encode(formatSSEMessage(connectResult)));

        // Create schema checker with base ID as schema
        const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
        const introspector = new PostgresSchemaIntrospector(db);
        const baseId = table.baseId().toString();

        const checker = createSchemaChecker({
          db,
          introspector,
          schema: baseId, // Use base ID as schema
        });

        // Stream check results
        for await (const result of checker.checkTable(table)) {
          if (request.signal.aborted) {
            break;
          }
          controller.enqueue(encoder.encode(formatSSEMessage(result)));
        }

        // Send completion message
        const completeResult: SchemaCheckResult = {
          id: 'complete',
          fieldId: '',
          fieldName: '',
          ruleId: 'completion',
          ruleDescription: 'Completion',
          status: 'success',
          message: '✅ Schema check completed',
          required: true,
          timestamp: Date.now(),
        };
        controller.enqueue(encoder.encode(formatSSEMessage(completeResult)));
        controller.close();
      } catch (e) {
        const errorResult: SchemaCheckResult = {
          id: 'error:unexpected',
          fieldId: '',
          fieldName: '',
          ruleId: 'unexpected',
          ruleDescription: 'Unexpected error',
          status: 'error',
          message: e instanceof Error ? e.message : 'Unknown error',
          required: true,
          timestamp: Date.now(),
        };
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
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

export const Route = createFileRoute('/api/schema/$tableId/check/stream')({
  server: {
    handlers: {
      GET: handleSSE,
    },
  },
});
