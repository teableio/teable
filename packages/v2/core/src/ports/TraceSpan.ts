/* eslint-disable @typescript-eslint/no-empty-function */
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';
import {
  TeableSpanAttributes,
  type ISpan,
  type ITracer,
  type SpanAttributes,
  type SpanAttributeValue,
  type TeableComponent,
  type TeableSpanName,
} from './Tracer';

type HandlerMethod<TResult> = (
  context: IExecutionContext,
  ...args: ReadonlyArray<unknown>
) => Promise<Result<TResult, DomainError>>;

type TraceAttributes =
  | SpanAttributes
  | ((context: IExecutionContext, message: unknown) => SpanAttributes);

/**
 * Options for the TraceSpan decorator.
 */
export interface TraceSpanOptions {
  /**
   * Custom span name. If not provided, defaults to 'teable.{HandlerName}.{methodName}'.
   */
  name?: TeableSpanName | `teable.${string}`;
  /**
   * Component type for this span. Defaults to 'handler'.
   */
  component?: TeableComponent;
  /**
   * Additional attributes to add to the span.
   */
  attributes?: TraceAttributes;
}

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
  methodName: string,
  component: TeableComponent,
  payload: unknown,
  context: IExecutionContext,
  attributes?: TraceAttributes
): SpanAttributes => {
  // Base teable attributes for all v2 spans
  const baseAttributes: SpanAttributes = {
    [TeableSpanAttributes.VERSION]: 'v2',
    [TeableSpanAttributes.COMPONENT]: component,
    [TeableSpanAttributes.HANDLER]: handlerName,
    [TeableSpanAttributes.OPERATION]: `${handlerName}.${methodName}`,
    'teable.message': resolveMessageName(payload),
  };
  if (!attributes) return baseAttributes;
  const extra = typeof attributes === 'function' ? attributes(context, payload) : attributes;
  return { ...baseAttributes, ...extra };
};

/**
 * Decorator for adding tracing to handler methods.
 * Automatically adds teable-specific attributes to all spans.
 *
 * @example
 * // Basic usage - auto-generates span name 'teable.{HandlerName}.{methodName}'
 * @TraceSpan()
 * async handle(context: IExecutionContext, command: MyCommand) { ... }
 *
 * @example
 * // With options
 * @TraceSpan({ component: 'service', attributes: { 'teable.table_id': tableId } })
 * async getById(context: IExecutionContext, id: string) { ... }
 *
 * @example
 * // With custom span name (deprecated - use options.name instead)
 * @TraceSpan('teable.custom.operation')
 * async customOp(context: IExecutionContext) { ... }
 */
export function TraceSpan(options?: TraceSpanOptions): MethodDecorator;
export function TraceSpan(
  spanName?: TeableSpanName | `teable.${string}`,
  attributes?: TraceAttributes
): MethodDecorator;
export function TraceSpan(
  optionsOrSpanName?: TraceSpanOptions | TeableSpanName | `teable.${string}`,
  legacyAttributes?: TraceAttributes
): MethodDecorator {
  // Normalize arguments to options object
  const options: TraceSpanOptions =
    typeof optionsOrSpanName === 'string'
      ? { name: optionsOrSpanName, attributes: legacyAttributes }
      : optionsOrSpanName ?? {};

  const { name: customSpanName, component = 'handler', attributes } = options;

  return (_target, propertyKey, descriptor) => {
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
      const methodName = String(propertyKey);
      const payload = args[0];
      const resolvedSpanName = customSpanName ?? `teable.${handlerName}.${methodName}`;
      const spanAttributes = resolveAttributes(
        handlerName,
        methodName,
        component,
        payload,
        context,
        attributes
      );
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
}
