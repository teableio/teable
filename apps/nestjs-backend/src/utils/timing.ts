/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line @typescript-eslint/naming-convention
export function Timing(): MethodDecorator {
  return (
    target: Object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<any>
  ) => {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args: any[]) {
      const start = process.hrtime.bigint();
      const result = originalMethod.apply(this, args);

      if (result instanceof Promise) {
        return result.then((data) => {
          const end = process.hrtime.bigint();
          console.log(
            `${String(propertyKey)} Execution Time: ${(end - start) / BigInt(1000000)} ms`
          );
          return data;
        });
      } else {
        const end = process.hrtime.bigint();
        console.log(`${String(propertyKey)} Execution Time: ${(end - start) / BigInt(1000000)} ms`);
        return result;
      }
    };
  };
}
