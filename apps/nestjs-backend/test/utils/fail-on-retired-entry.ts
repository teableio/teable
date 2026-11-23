/** Replace an engine entry only for the retired call category, after fixtures exist. */
export const failOnRetiredEntry = (
  target: object,
  entry: string,
  matches: (args: readonly unknown[]) => boolean = () => true
): (() => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(target, entry);
  const original: unknown = Reflect.get(target, entry);
  Object.defineProperty(target, entry, {
    configurable: true,
    writable: true,
    value: function (this: unknown, ...args: unknown[]) {
      if (matches(args)) {
        throw new Error(`Retired legacy entry called: ${entry}`);
      }
      if (typeof original !== 'function') {
        throw new Error(`No retained legacy implementation for: ${entry}`);
      }
      return Reflect.apply(original, this, args);
    },
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(target, entry, descriptor);
    } else {
      Reflect.deleteProperty(target, entry);
    }
  };
};
