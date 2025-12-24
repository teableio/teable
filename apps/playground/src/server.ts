import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  createStartHandler,
  defaultStreamHandler,
  defineHandlerCallback,
} from '@tanstack/react-start/server';
import { createServerEntry } from '@tanstack/react-start/server-entry';
import { ensureServerOtel } from './server/otel';
import { extractRequestContext } from './server/traceContext';
import { applyTraceHeaders } from './server/traceResponseHeaders';

void ensureServerOtel();

const handler = defineHandlerCallback(async (ctx) => {
  const tracer = trace.getTracer('tanstack-start');
  const url = new URL(ctx.request.url);
  const method = ctx.request.method ?? 'GET';
  const matches = ctx.router?.state?.matches ?? [];
  const leaf = matches[matches.length - 1];
  const routeId = leaf?.routeId ?? url.pathname;
  const spanName = `tanstack.start ${routeId}`;
  const parentContext = extractRequestContext(ctx.request);

  return tracer.startActiveSpan(
    spanName,
    {
      attributes: {
        'http.method': method,
        'http.route': routeId,
        'http.url': url.pathname,
      },
    },
    parentContext,
    async (span) => {
      try {
        const response = await defaultStreamHandler(ctx);
        span.setAttribute('http.status_code', response.status);
        if (response.status >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        return applyTraceHeaders(response, span.spanContext());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        span.recordException(error instanceof Error ? error : message);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        throw error;
      } finally {
        span.end();
      }
    }
  );
});

const fetch = createStartHandler(handler);

export default createServerEntry({ fetch });
