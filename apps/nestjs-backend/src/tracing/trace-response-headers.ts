/* eslint-disable @typescript-eslint/naming-convention */
import { trace, TraceFlags } from '@opentelemetry/api';
import type { Response } from 'express';

export const buildTraceLink = (traceId: string, baseUrl?: string) => {
  const normalizedBaseUrl = baseUrl?.replace(/\/+$/, '');
  if (!normalizedBaseUrl) return null;
  return `${normalizedBaseUrl}/trace/${traceId}?uiEmbed=v0`;
};

export const buildTraceparent = (traceId: string, spanId: string, traceFlags: TraceFlags) => {
  const sampled = (traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED;
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
};

export const setResponseHeaderIfPossible = (
  response: Pick<Response, 'headersSent' | 'writableEnded' | 'destroyed' | 'setHeader'>,
  name: string,
  value: string
) => {
  if (response.headersSent || response.writableEnded || response.destroyed) {
    return;
  }

  response.setHeader(name, value);
};

export const applyTraceResponseHeaders = (
  response: Pick<Response, 'headersSent' | 'writableEnded' | 'destroyed' | 'setHeader'>,
  traceLinkBaseUrl = process.env.TRACE_LINK_BASE_URL
) => {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }

  const spanContext = span.spanContext();
  setResponseHeaderIfPossible(
    response,
    'traceparent',
    buildTraceparent(spanContext.traceId, spanContext.spanId, spanContext.traceFlags)
  );

  const traceLink = buildTraceLink(spanContext.traceId, traceLinkBaseUrl);
  if (traceLink) {
    setResponseHeaderIfPossible(response, 'Link', `<${traceLink}>; rel="trace"`);
  }
};
