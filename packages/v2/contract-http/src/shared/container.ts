export type IClassToken<T> = new (...args: any[]) => T;

export interface IHandlerResolver {
  resolve<T>(token: IClassToken<T>): T;
}
