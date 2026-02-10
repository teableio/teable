export type IClassToken<T> = new (...args: unknown[]) => T;
export type IHandlerToken<T> = IClassToken<T> | symbol;

export interface IHandlerResolver {
  resolve<T>(token: IHandlerToken<T>): T;
}
