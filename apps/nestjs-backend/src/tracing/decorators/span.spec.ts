import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Span } from './span';

describe('Span exception classification', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { error: new BadRequestException('invalid request'), expected: SpanStatusCode.UNSET },
    {
      error: new InternalServerErrorException('database unavailable'),
      expected: SpanStatusCode.ERROR,
    },
    { error: null, expected: SpanStatusCode.ERROR },
    { error: 'unexpected rejection', expected: SpanStatusCode.ERROR },
    { error: new Error('unexpected failure'), expected: SpanStatusCode.ERROR },
  ])(
    'preserves thrown errors without promoting routine client rejection: $expected',
    async ({ error, expected }) => {
      const exporter = new InMemorySpanExporter();
      const provider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });
      vi.spyOn(trace, 'getTracer').mockReturnValue(provider.getTracer('span-policy-test'));
      class RequestStage {
        @Span()
        async execute() {
          throw error;
        }
      }
      await expect(new RequestStage().execute()).rejects.toBe(error);
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      expect(spans[0].status.code).toBe(expected);
      expect(spans[0].events.some((event) => event.name === 'exception')).toBe(true);
      await provider.shutdown();
    }
  );
});
