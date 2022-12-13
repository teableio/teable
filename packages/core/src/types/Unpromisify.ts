export type IUnPromisify<T> = T extends Promise<infer U> ? U : T;
