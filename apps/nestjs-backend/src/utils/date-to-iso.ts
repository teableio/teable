export const dateToIso = <T extends object>(obj: T) => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ])
  ) as {
    [K in keyof T]: T[K] extends Date ? string : T[K];
  };
};
