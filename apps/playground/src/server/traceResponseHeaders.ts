import { TraceFlags, trace, type SpanContext } from '@opentelemetry/api';

const normalizeBaseUrl = (value?: string) => value?.replace(/\/+$/, '');

const buildTraceLink = (traceId: string) => {
  const baseUrl = normalizeBaseUrl(process.env.PLAYGROUND_TRACE_LINK_BASE_URL);
  if (!baseUrl) return null;
  return `${baseUrl}/trace/${traceId}?uiEmbed=v0`;
};

const buildTraceparent = (traceId: string, spanId: string, traceFlags: TraceFlags) => {
  const sampled = (traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED;
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
};

const resolveSpanContext = (provided?: SpanContext) => {
  if (provided?.traceId && provided?.spanId) return provided;
  const span = trace.getActiveSpan();
  return span?.spanContext();
};

export const applyTraceHeaders = (response: Response, spanContext?: SpanContext): Response => {
  const resolvedContext = resolveSpanContext(spanContext);
  if (!resolvedContext?.traceId || !resolvedContext?.spanId) return response;

  const headers = new Headers(response.headers);
  headers.set(
    'traceparent',
    buildTraceparent(resolvedContext.traceId, resolvedContext.spanId, resolvedContext.traceFlags)
  );

  const traceLink = buildTraceLink(resolvedContext.traceId);
  if (traceLink) {
    headers.append('Link', `<${traceLink}>; rel="trace"`);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
