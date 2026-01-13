import { createFileRoute } from '@tanstack/react-router';
import {
  MetaChecker,
  type MetaValidationIssue,
} from '@teable/v2-adapter-table-repository-postgres';
import { ActorId, TableByIdSpec, TableId, Table, v2CoreTokens } from '@teable/v2-core';
import type { IExecutionContext, ITableRepository } from '@teable/v2-core';

import { PLAYGROUND_ACTOR_ID } from '@/lib/playground/constants';
import { PLAYGROUND_DB_URL_QUERY_PARAM } from '@/lib/playground/databaseUrl';
import { createPlaygroundContainer } from '@/server/playgroundContainer';
import { v2Tracer } from '@/server/otel';

// Meta check result format for SSE
interface MetaCheckSSEResult {
  id: string;
  type: 'connect' | 'issue' | 'complete' | 'error';
  issue?: MetaValidationIssue;
  message?: string;
  timestamp: number;
}

const formatSSEMessage = (result: MetaCheckSSEResult): string => {
  return `data: ${JSON.stringify(result)}\n\n`;
};

const yieldToEventLoop = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
          const errorResult: MetaCheckSSEResult = {
            id: 'error:invalid_table_id',
            type: 'error',
            message: `Invalid table ID: ${tableIdResult.error}`,
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
          const errorResult: MetaCheckSSEResult = {
            id: 'error:actor_id',
            type: 'error',
            message: `Invalid actor ID: ${actorIdResult.error}`,
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
          const errorResult: MetaCheckSSEResult = {
            id: 'error:table_not_found',
            type: 'error',
            message: `Table not found: ${tableResult.error.message}`,
            timestamp: Date.now(),
          };
          controller.enqueue(encoder.encode(formatSSEMessage(errorResult)));
          controller.close();
          return;
        }

        const table = tableResult.value;
        const baseId = table.baseId();

        // Send connection confirmation
        const connectResult: MetaCheckSSEResult = {
          id: 'connect',
          type: 'connect',
          message: `Meta check stream connected for table: ${table.name().toString()}`,
          timestamp: Date.now(),
        };
        controller.enqueue(encoder.encode(formatSSEMessage(connectResult)));
        await yieldToEventLoop();

        // Load all tables in the base for reference validation
        const allTablesSpecResult = Table.specs(baseId).build();
        if (allTablesSpecResult.isErr()) {
          const errorResult: MetaCheckSSEResult = {
            id: 'error:spec',
            type: 'error',
            message: `Failed to build spec: ${allTablesSpecResult.error.message}`,
            timestamp: Date.now(),
          };
          controller.enqueue(encoder.encode(formatSSEMessage(errorResult)));
          controller.close();
          return;
        }

        const allTablesResult = await tableRepository.find(context, allTablesSpecResult.value);
        if (allTablesResult.isErr()) {
          const errorResult: MetaCheckSSEResult = {
            id: 'error:load_tables',
            type: 'error',
            message: `Failed to load tables: ${allTablesResult.error.message}`,
            timestamp: Date.now(),
          };
          controller.enqueue(encoder.encode(formatSSEMessage(errorResult)));
          controller.close();
          return;
        }

        // Create meta checker
        const checker = new MetaChecker({
          tableRepository,
          executionContext: context,
        });

        // Stream check results
        let issueIndex = 0;
        for await (const issue of checker.checkTable(table, baseId)) {
          if (request.signal.aborted) {
            break;
          }
          const issueResult: MetaCheckSSEResult = {
            id: `issue:${issueIndex++}`,
            type: 'issue',
            issue,
            timestamp: Date.now(),
          };
          controller.enqueue(encoder.encode(formatSSEMessage(issueResult)));
          await yieldToEventLoop();
        }

        // Send completion message
        const completeResult: MetaCheckSSEResult = {
          id: 'complete',
          type: 'complete',
          message: 'Meta check completed',
          timestamp: Date.now(),
        };
        controller.enqueue(encoder.encode(formatSSEMessage(completeResult)));
        controller.close();
      } catch (e) {
        const errorResult: MetaCheckSSEResult = {
          id: 'error:unexpected',
          type: 'error',
          message: e instanceof Error ? e.message : 'Unknown error',
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

export const Route = createFileRoute('/api/meta/$tableId/check/stream')({
  server: {
    handlers: {
      GET: handleSSE,
    },
  },
});
