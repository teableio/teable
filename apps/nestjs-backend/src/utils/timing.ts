/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/naming-convention
export function Timing(customLoggerKey?: string): MethodDecorator {
  const logger = new Logger('Timing');
  return (
    target: Object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<any>
  ) => {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args: any[]) {
      const start = process.hrtime.bigint();
      const result = originalMethod.apply(this, args);
      const className = target.constructor.name;

      if (result instanceof Promise) {
        return result.then((data) => {
          const end = process.hrtime.bigint();
          logger.log(
            `${className} - ${String(customLoggerKey || propertyKey)} Execution Time: ${
              (end - start) / BigInt(1000000)
            } ms`
          );
          return data;
        });
      } else {
        const end = process.hrtime.bigint();
        logger.log(
          `${className} - ${String(customLoggerKey || propertyKey)} Execution Time: ${
            (end - start) / BigInt(1000000)
          } ms`
        );
        return result;
      }
    };
  };
}
