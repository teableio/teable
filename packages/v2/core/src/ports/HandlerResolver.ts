export type IClassToken<T> = new (...args: unknown[]) => T;

export interface IHandlerResolver {
  resolve<T>(token: IClassToken<T>): T;
}
