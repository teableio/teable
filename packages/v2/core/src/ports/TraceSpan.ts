/* eslint-disable @typescript-eslint/no-empty-function */
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, isDomainError, type DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';
import type {
  ISpan,
  ITracer,
  SpanAttributes,
  SpanAttributeValue,
  TeableSpanAttributes,
} from './Tracer';
import { teableSpanAttributes } from './Tracer';

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
  setTeableAttributes(_attributes: TeableSpanAttributes) {},
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

/**
 * Extract teable-specific attributes from a command/query payload.
 * Automatically detects common properties like baseId, tableId, fieldId.
 */
const extractTeableAttributes = (handlerName: string, payload: unknown): TeableSpanAttributes => {
  const attrs: TeableSpanAttributes = {};

  // Determine if this is a command or query handler
  const isCommand =
    handlerName.toLowerCase().includes('command') || handlerName.endsWith('Handler');
  const isQuery = handlerName.toLowerCase().includes('query');

  if (isCommand) {
    attrs[teableSpanAttributes['teable.command.name']] = resolveMessageName(payload);
  } else if (isQuery) {
    attrs[teableSpanAttributes['teable.read.name']] = resolveMessageName(payload);
  }

  if (!payload || typeof payload !== 'object') return attrs;

  const p = payload as Record<string, unknown>;

  // Extract baseId
  if ('baseId' in p && p.baseId) {
    const baseId = extractIdString(p.baseId);
    if (baseId) {
      if (isCommand) {
        attrs[teableSpanAttributes['teable.command.base_id']] = baseId;
      } else {
        attrs[teableSpanAttributes['teable.read.base_id']] = baseId;
      }
    }
  }

  // Extract tableId
  if ('tableId' in p && p.tableId) {
    const tableId = extractIdString(p.tableId);
    if (tableId) {
      if (isCommand) {
        attrs[teableSpanAttributes['teable.command.table_id']] = tableId;
      } else {
        attrs[teableSpanAttributes['teable.read.table_id']] = tableId;
      }
    }
  }

  // Extract fieldId (command only)
  if ('fieldId' in p && p.fieldId) {
    const fieldId = extractIdString(p.fieldId);
    if (fieldId) {
      attrs[teableSpanAttributes['teable.command.field_id']] = fieldId;
    }
  }

  // Extract record count for batch operations
  if ('fieldValues' in p && Array.isArray(p.fieldValues)) {
    attrs[teableSpanAttributes['teable.command.record_count']] = p.fieldValues.length;
  }

  return attrs;
};

/**
 * Extract string value from an ID (handles both string and ValueObject).
 */
const extractIdString = (id: unknown): string | undefined => {
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object' && 'toString' in id && typeof id.toString === 'function') {
    const str = id.toString();
    // Avoid [object Object] style strings
    if (str && !str.startsWith('[object')) {
      return str;
    }
  }
  return undefined;
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
          // Set teable-specific attributes automatically
          const teableAttrs = extractTeableAttributes(handlerName, payload);
          span.setTeableAttributes(teableAttrs);
        } catch {
          span = noopSpan;
        }
      }

      try {
        const execute = async () => {
          const result = await original.apply(this, [context, ...args]);
          if (isResult(result) && result.isErr()) {
            span.recordError(result.error.toString());
            // Add error attributes
            const errorResult = result as Result<unknown, DomainError>;
            if (errorResult.isErr()) {
              // Use first tag as category
              const category = errorResult.error.tags[0];
              if (category) {
                span.setTeableAttributes({
                  [teableSpanAttributes['teable.error.category']]: category,
                });
              }
              if (errorResult.error.code) {
                span.setTeableAttributes({
                  [teableSpanAttributes['teable.error.code']]: errorResult.error.code,
                });
              }
            }
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
