// eslint-disable-next-line @typescript-eslint/naming-convention
export type ExcludeAction<T extends string, F extends string> = T extends F ? never : T;

// eslint-disable-next-line @typescript-eslint/naming-convention
export type PickAction<T extends string, F extends string> = T extends F ? T : never;
