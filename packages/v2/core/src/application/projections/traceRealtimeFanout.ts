import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import type { SpanAttributes, TeableSpanName } from '../../ports/Tracer';

export const buildRealtimeFanoutSpanAttributes = (params: {
  totalRecordCount: number;
  chunkRecordCount: number;
  fanoutCount: number;
  skipRealtime: boolean;
  orchestration?: {
    totalChunkCount: number;
    chunkIndex: number;
    scope: 'operation' | 'chunk';
  };
}): SpanAttributes => ({
  'teable.total_record_count': params.totalRecordCount,
  'teable.chunk_record_count': params.chunkRecordCount,
  'teable.total_chunk_count': params.orchestration?.totalChunkCount ?? 1,
  'teable.chunk_index': params.orchestration?.chunkIndex ?? 0,
  'teable.batch_scope': params.orchestration?.scope ?? 'operation',
  'teable.skip_realtime': params.skipRealtime,
  'teable.fanout_count': params.fanoutCount,
});

export const withRealtimeFanoutSpan = async <T>(
  context: ExecutionContextPort.IExecutionContext,
  name: TeableSpanName,
  attributes: SpanAttributes,
  callback: () => Promise<T>
): Promise<T> => {
  const tracer = context.tracer;
  const span = tracer?.startSpan(name, attributes);
  if (!tracer || !span) {
    return callback();
  }

  return tracer.withSpan(span, async () => {
    try {
      return await callback();
    } finally {
      span.end();
    }
  });
};
