/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { Span } from '../tracing/decorators/span';
import * as ErrorReport from './error-report';

type ReportSeverity = Extract<Parameters<typeof ErrorReport.captureMessage>[1], string>;

type TimingOptions = {
  key?: string;
  thresholdMs?: number;
  reportOnThreshold?: boolean;
  reportLevel?: ReportSeverity;
  reportTag?: string;
  // Attach OTEL trace ids to the report context for correlation
  attachActiveSpan?: boolean;
  // Extra context for the report; can be static or derived from method args/this
  reportContext?:
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
    reportOnThreshold = false,
    reportLevel = 'warning',
    reportTag,
    attachActiveSpan = true,
    reportContext,
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
          if (reportOnThreshold) {
            ErrorReport.withScope((scope) => {
              scope.setLevel(reportLevel);
              scope.setTag('feature', 'timing');
              scope.setTag('timing.class', className);
              scope.setTag('timing.method', methodName);
              if (reportTag) {
                scope.setTag('timing.tag', reportTag);
              }
              const extraContext =
                typeof reportContext === 'function' ? reportContext(args, this) : reportContext;
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
              ErrorReport.captureMessage(
                `${className}.${methodName} exceeded timing threshold (${durationMs}ms > ${thresholdMs}ms)`,
                reportLevel
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
