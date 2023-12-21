export type IRecursivelyReplaceNullWithUndefined<T> = T extends null
  ? undefined
  : T extends Date
    ? T
    : {
        [K in keyof T]: T[K] extends (infer U)[]
          ? IRecursivelyReplaceNullWithUndefined<U>[]
          : IRecursivelyReplaceNullWithUndefined<T[K]>;
      };
