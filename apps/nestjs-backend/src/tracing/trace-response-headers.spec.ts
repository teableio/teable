import { TraceFlags } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import {
  applyTraceResponseHeaders,
  buildTraceparent,
  setResponseHeaderIfPossible,
} from './trace-response-headers';

const { getActiveSpan } = vi.hoisted(() => ({
  getActiveSpan: vi.fn(),
}));

vi.mock('@opentelemetry/api', async () => {
  const actual = await vi.importActual('@opentelemetry/api');
  return {
    ...actual,
    trace: {
      ...actual.trace,
      getActiveSpan,
    },
  };
});

describe('trace-response-headers', () => {
  it('writes traceparent and Link when an active span is present', () => {
    const response = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      setHeader: vi.fn(),
    };
    getActiveSpan.mockReturnValue({
      spanContext: () => ({
        traceId: '6193d505b7487e6a6481c164d8431217',
        spanId: '454291e68f397f75',
        traceFlags: TraceFlags.SAMPLED,
      }),
    });

    applyTraceResponseHeaders(response, 'https://jaeger-pr-cloud-1560.sealoshzh.site');

    expect(response.setHeader).toHaveBeenCalledWith(
      'traceparent',
      buildTraceparent('6193d505b7487e6a6481c164d8431217', '454291e68f397f75', TraceFlags.SAMPLED)
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Link',
      '<https://jaeger-pr-cloud-1560.sealoshzh.site/trace/6193d505b7487e6a6481c164d8431217?uiEmbed=v0>; rel="trace"'
    );
  });

  it('does not write headers after the response has started', () => {
    const response = {
      headersSent: true,
      writableEnded: false,
      destroyed: false,
      setHeader: vi.fn(),
    };

    setResponseHeaderIfPossible(response, 'Link', 'value');

    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
