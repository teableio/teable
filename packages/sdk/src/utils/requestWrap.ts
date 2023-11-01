import { createQueryClient } from '../context/app/queryClient';

const queryClient = createQueryClient();

type IRequestFunction<T extends unknown[], R> = (...args: T) => R;

export function requestWrap<T extends unknown[], R>(
  fn: IRequestFunction<T, Promise<R>>,
  key?: string
): IRequestFunction<T, Promise<R>> {
  return (...args: T) =>
    queryClient.fetchQuery({
      queryKey: [key || fn.name, ...args],
      queryFn: () => fn(...args),
    });
}
