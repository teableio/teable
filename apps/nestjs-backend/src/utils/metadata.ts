/* eslint-disable @typescript-eslint/no-explicit-any */
export const copyDecoratorMetadata = (originalFunction: any, newFunction: any): void => {
  // Get the current metadata and set onto the wrapper
  // to ensure other decorators ( ie: NestJS EventPattern / RolesGuard )
  // won't be affected by the use of this instrumentation
  Reflect.getMetadataKeys(originalFunction).forEach((metadataKey) => {
    Reflect.defineMetadata(
      metadataKey,
      Reflect.getMetadata(metadataKey, originalFunction),
      newFunction
    );
  });
};
