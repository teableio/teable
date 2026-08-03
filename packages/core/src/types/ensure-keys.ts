// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IEnsureKeysMatchInterface<T, K extends readonly any[]> = K extends readonly (keyof T)[]
  ? keyof T extends K[number]
    ? K[number] extends keyof T
      ? true
      : never
    : never
  : never;
