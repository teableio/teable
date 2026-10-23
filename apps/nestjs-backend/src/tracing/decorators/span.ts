/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import type { Span as ApiSpan, SpanOptions } from '@opentelemetry/api';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { exceptionParse } from '../../utils/exception-parse';
import { copyDecoratorMetadata } from '../../utils/metadata';

const recordException = (span: ApiSpan, error: unknown) => {
  const exception =
    error instanceof Error || typeof error === 'string' ? error : 'Non-Error exception';
  span.recordException(exception);
  // Match the HTTP exception filter: routine 4xx rejections must not promote
  // sampled-out traces, while unexpected failures and 5xx retain full detail.
  const status = error instanceof Error ? exceptionParse(error).getStatus() : 500;
  if (status >= 500) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Non-Error exception',
    });
  }
};

export function Span(name?: string, options: SpanOptions = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<any>) => {
    const originalFunction = descriptor.value;
    const wrappedFunction = function (this: any, ...args: any[]) {
      const spanName = name || `${target.constructor.name}.${String(propertyKey)}`;
      const tracer = trace.getTracer('default');

      return tracer.startActiveSpan(spanName, options, (span) => {
        if (originalFunction.constructor.name === 'AsyncFunction') {
          return originalFunction
            .apply(this, args)
            .catch((error: any) => {
              recordException(span, error);
              // Throw error to propagate it further
              throw error;
            })
            .finally(() => {
              span.end();
            });
        }

        try {
          return originalFunction.apply(this, args);
        } catch (error) {
          recordException(span, error);
          // Throw error to propagate it further
          throw error;
        } finally {
          span.end();
        }
      });
    };

    descriptor.value = wrappedFunction;

    copyDecoratorMetadata(originalFunction, wrappedFunction);
  };
}
