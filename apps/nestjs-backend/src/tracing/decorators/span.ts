/* eslint-disable @typescript-eslint/naming-convention */
import type { Span as ApiSpan, SpanOptions } from '@opentelemetry/api';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { exceptionParse } from '../../utils/exception-parse';
import { copyDecoratorMetadata } from '../../utils/metadata';

const spanOptionsKey = Symbol('teable.span.options');

export const annotateSpan = (method: object, attributes: SpanOptions['attributes']) => {
  // Other decorators copy this metadata along with Nest's handler metadata.
  const options = Reflect.getOwnMetadata(spanOptionsKey, method) as SpanOptions | undefined;
  if (!options) return false;
  options.attributes = { ...options.attributes, ...attributes };
  return true;
};
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
  options = { ...options, attributes: { ...options.attributes } };
  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    // Method decorators receive a callable descriptor; argument types are erased here.
    const originalFunction = descriptor.value as (...args: unknown[]) => unknown;
    const spanName = name || `${target.constructor.name}.${String(propertyKey)}`;
    const wrappedFunction = function (this: unknown, ...args: unknown[]) {
      const tracer = trace.getTracer('default');
      // Async generators execute only when pulled. Bind every iterator operation,
      // not the caller's context between pulls, and close on return/throw as well.
      if (originalFunction.constructor.name === 'AsyncGeneratorFunction') {
        const parentContext = context.active();
        // The native async-generator constructor guarantees this iterator shape.
        const iterator = originalFunction.apply(this, args) as AsyncGenerator<
          unknown,
          unknown,
          unknown
        >;
        let span: ApiSpan | undefined;
        let ended = false;
        const invoke = async (method: 'next' | 'return' | 'throw', value: unknown) => {
          if (!span && !ended && method === 'next') {
            span = tracer.startSpan(spanName, options, parentContext);
          }
          const activeContext = span ? trace.setSpan(parentContext, span) : parentContext;
          try {
            const result = await context.with(activeContext, () => iterator[method](value));
            if (result.done) {
              span?.end();
              span = undefined;
              ended = true;
            }
            return result;
          } catch (error) {
            if (span) {
              recordException(span, error);
              span.end();
              span = undefined;
            }
            ended = true;
            throw error;
          }
        };
        return {
          next: (value: unknown) => invoke('next', value),
          return: (value: unknown) => invoke('return', value),
          throw: (error: unknown) => invoke('throw', error),
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      }

      return tracer.startActiveSpan(spanName, options, (span) => {
        try {
          const result = originalFunction.apply(this, args);
          // Methods returning promises need not have an AsyncFunction constructor
          // (decorator wrappers and transpilation commonly erase it).
          if (
            result &&
            typeof result === 'object' &&
            'then' in result &&
            typeof result.then === 'function'
          ) {
            return Promise.resolve(result).then(
              (value) => {
                span.end();
                return value;
              },
              (error) => {
                recordException(span, error);
                span.end();
                throw error;
              }
            );
          }
          span.end();
          return result;
        } catch (error) {
          recordException(span, error);
          span.end();
          throw error;
        }
      });
    };

    descriptor.value = wrappedFunction;

    copyDecoratorMetadata(originalFunction, wrappedFunction);
    Reflect.defineMetadata(spanOptionsKey, options, wrappedFunction);
  };
}
