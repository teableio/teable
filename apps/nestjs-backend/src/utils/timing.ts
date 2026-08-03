/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/nestjs';
import { Span } from '../tracing/decorators/span';

type SentrySeverity = Extract<Parameters<typeof Sentry.captureMessage>[1], string>;

type TimingOptions = {
  key?: string;
  thresholdMs?: number;
  reportToSentry?: boolean;
  sentryLevel?: SentrySeverity;
  sentryTag?: string;
  // Attach OTEL trace ids to Sentry context for correlation
  attachActiveSpan?: boolean;
  // Extra context for sentry; can be static or derived from method args/this
  sentryContext?:
    | Record<string, unknown>
    | ((args: any[], instance: unknown) => Record<string, unknown> | undefined);
};

export function Timing(customLoggerKeyOrOptions?: string | TimingOptions): MethodDecorator {
  const logger = new Logger('Timing');
  const options: TimingOptions =
    typeof customLoggerKeyOrOptions === 'string'
      ? { key: customLoggerKeyOrOptions }
      : customLoggerKeyOrOptions || {};
  const {
    key,
    thresholdMs = 100,
    reportToSentry = false,
    sentryLevel = 'warning',
    sentryTag,
    attachActiveSpan = true,
    sentryContext,
  } = options;

  return (
    target: Object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<any>
  ) => {
    // Enhancements to the current decorator can be reported to the link tracking system
    Span()(target, propertyKey, descriptor);

    const originalMethod = descriptor.value;
    descriptor.value = function (...args: any[]) {
      const start = process.hrtime.bigint();
      const result = originalMethod.apply(this, args);
      const className = target.constructor.name;
      const methodName = String(propertyKey);

      const report = () => {
        const end = process.hrtime.bigint();
        const durationMs = Number((end - start) / BigInt(1000000));
        if (durationMs > thresholdMs) {
          const heapUsedMb = Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
          const activeSpan = attachActiveSpan ? trace.getActiveSpan() : undefined;
          const spanContext = activeSpan?.spanContext();
          logger.log(
            `${className} - ${String(key || propertyKey)} Execution Time: ${durationMs} ms; Heap Usage: ${heapUsedMb} MB`
          );
          if (reportToSentry) {
            Sentry.withScope((scope) => {
              scope.setLevel?.(sentryLevel);
              scope.setTag('feature', 'timing');
              scope.setTag('timing.class', className);
              scope.setTag('timing.method', methodName);
              if (sentryTag) {
                scope.setTag('timing.tag', sentryTag);
              }
              const extraContext =
                typeof sentryContext === 'function' ? sentryContext(args, this) : sentryContext;
              if (extraContext) {
                scope.setContext('timing.extra', extraContext);
              }
              if (spanContext) {
                scope.setContext('trace', {
                  trace_id: spanContext.traceId,
                  span_id: spanContext.spanId,
                  op: 'timing',
                  status: 'ok',
                });
              }
              scope.setContext('timing', {
                durationMs,
                thresholdMs,
                heapUsedMb,
                argsLength: args?.length ?? 0,
                traceId: spanContext?.traceId,
                spanId: spanContext?.spanId,
              });
              Sentry.captureMessage(
                `${className}.${methodName} exceeded timing threshold (${durationMs}ms > ${thresholdMs}ms)`,
                sentryLevel
              );
            });
          }
        }
      };

      if (result instanceof Promise) {
        return result
          .then((data) => {
            report();
            return data;
          })
          .catch((error) => {
            report();
            throw error;
          });
      }
      report();
      return result;
    };
  };
}
