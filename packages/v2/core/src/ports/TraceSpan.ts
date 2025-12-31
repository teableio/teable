/* eslint-disable @typescript-eslint/no-empty-function */
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';
import type { ISpan, ITracer, SpanAttributes, SpanAttributeValue } from './Tracer';

type HandlerMethod<TResult> = (
  context: IExecutionContext,
  ...args: ReadonlyArray<unknown>
) => Promise<Result<TResult, DomainError>>;

type TraceAttributes =
  | SpanAttributes
  | ((context: IExecutionContext, message: unknown) => SpanAttributes);

const traceSpanWrappedSymbol = Symbol('v2.traceSpanWrapped');

type TraceSpanWrapped = {
  [traceSpanWrappedSymbol]?: true;
};

export const isTraceSpanWrapped = (value: unknown): boolean => {
  if (typeof value !== 'function') return false;
  return Boolean((value as TraceSpanWrapped)[traceSpanWrappedSymbol]);
};

const noopSpan: ISpan = {
  setAttribute(_key: string, _value: SpanAttributeValue) {},
  setAttributes(_attributes: SpanAttributes) {},
  recordError(_message: string) {},
  end() {},
};

const isResult = (value: unknown): value is Result<unknown, DomainError> => {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as { isErr?: unknown }).isErr === 'function';
};

const resolveMessageName = (message: unknown): string => {
  if (!message || typeof message !== 'object') return 'unknown';
  const ctorName = (message as { constructor?: { name?: string } }).constructor?.name;
  return ctorName && ctorName.length > 0 ? ctorName : 'unknown';
};

const describeError = (error: unknown): string => {
  if (isDomainError(error)) return error.message;
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

const resolveTracer = (context: IExecutionContext, target: unknown): ITracer | undefined => {
  if (context?.tracer) return context.tracer;
  const maybeTracer = (target as { tracer?: ITracer } | undefined)?.tracer;
  return maybeTracer && typeof maybeTracer.startSpan === 'function' ? maybeTracer : undefined;
};

const resolveAttributes = (
  handlerName: string,
  payload: unknown,
  context: IExecutionContext,
  attributes?: TraceAttributes
): SpanAttributes => {
  const baseAttributes: SpanAttributes = {
    handler: handlerName,
    message: resolveMessageName(payload),
  };
  if (!attributes) return baseAttributes;
  const extra = typeof attributes === 'function' ? attributes(context, payload) : attributes;
  return { ...baseAttributes, ...extra };
};

export const TraceSpan =
  (spanName?: string, attributes?: TraceAttributes): MethodDecorator =>
  (_target, propertyKey, descriptor) => {
    const original = descriptor.value as HandlerMethod<unknown> | undefined;
    if (!original) return;

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    descriptor.value = async function (
      this: unknown,
      context: IExecutionContext,
      ...args: ReadonlyArray<unknown>
    ) {
      const handlerName =
        (this as { constructor?: { name?: string } }).constructor?.name ?? 'Handler';
      const payload = args[0];
      const resolvedSpanName = spanName ?? `teable.${handlerName}.${String(propertyKey)}`;
      const spanAttributes = resolveAttributes(handlerName, payload, context, attributes);
      const tracer = resolveTracer(context, this);

      let span = noopSpan;
      if (tracer) {
        try {
          span = tracer.startSpan(resolvedSpanName, spanAttributes);
        } catch {
          span = noopSpan;
        }
      }

      try {
        const execute = async () => {
          const result = await original.apply(this, [context, ...args]);
          if (isResult(result) && result.isErr()) {
            span.recordError(result.error.toString());
          }
          return result;
        };

        if (tracer) {
          return await tracer.withSpan(span, execute);
        }
        return await execute();
      } catch (error) {
        const errorMessage = describeError(error) || 'Command handler execution failed';
        span.recordError(errorMessage);
        return err(domainError.unexpected({ message: errorMessage }));
      } finally {
        try {
          span.end();
        } catch {
          // Ignore tracer cleanup errors in core.
        }
      }
    };

    (descriptor.value as TraceSpanWrapped)[traceSpanWrappedSymbol] = true;

    return descriptor;
  };
