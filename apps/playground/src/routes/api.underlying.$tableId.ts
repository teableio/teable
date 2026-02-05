import { createFileRoute } from '@tanstack/react-router';
import {
  registerV2DebugData,
  v2DebugDataTokens,
  type DebugDataService,
  type DebugTableMeta,
  type DebugFieldMeta,
  type DebugRawRecordQueryResult,
} from '@teable/v2-debug-data';
import { createPlaygroundContainer } from '@/server/playgroundContainer';
import { PLAYGROUND_DB_URL_QUERY_PARAM } from '@/lib/playground/databaseUrl';

type UnderlyingDataResponse = {
  tableMeta: DebugTableMeta | null;
  fields: DebugFieldMeta[] | null;
  rawRecords: DebugRawRecordQueryResult | null;
  error: string | null;
};

async function handleGet({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string>;
}): Promise<Response> {
  const { tableId } = params;
  const url = new URL(request.url);

  // Parse query params
  const connectionString = url.searchParams.get(PLAYGROUND_DB_URL_QUERY_PARAM)?.trim() || undefined;
  const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  try {
    const container = await createPlaygroundContainer({ connectionString });

    // Register debug-data service
    registerV2DebugData(container);
    const service = container.resolve(v2DebugDataTokens.debugDataService) as DebugDataService;

    // Get table meta
    const tableMetaResult = await service.getTableMeta(tableId);
    const tableMeta = tableMetaResult.isOk() ? tableMetaResult.value : null;

    // Get fields
    const fieldsResult = await service.getFieldsByTableId(tableId);
    const fields = fieldsResult.isOk() ? fieldsResult.value : null;

    // Get raw records
    const rawRecordsResult = await service.getRawRecords(tableId, { limit, offset });
    const rawRecords = rawRecordsResult.isOk() ? rawRecordsResult.value : null;

    const response: UnderlyingDataResponse = {
      tableMeta,
      fields,
      rawRecords,
      error: null,
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const response: UnderlyingDataResponse = {
      tableMeta: null,
      fields: null,
      rawRecords: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const Route = createFileRoute('/api/underlying/$tableId')({
  server: {
    handlers: {
      GET: handleGet,
    },
  },
});
