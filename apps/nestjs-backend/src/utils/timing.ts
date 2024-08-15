/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { Logger } from '@nestjs/common';
import { Span } from '../tracing/decorators/span';

export function Timing(customLoggerKey?: string): MethodDecorator {
  const logger = new Logger('Timing');
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

      const printLog = () => {
        const end = process.hrtime.bigint();
        const gap = (end - start) / BigInt(1000000);
        if (gap > 100) {
          logger.log(
            `${className} - ${String(customLoggerKey || propertyKey)} Execution Time: ${gap} ms; Heap Usage: ${
              Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100
            } MB`
          );
        }
      };

      if (result instanceof Promise) {
        return result.then((data) => {
          printLog();
          return data;
        });
      } else {
        printLog();
        return result;
      }
    };
  };
}
