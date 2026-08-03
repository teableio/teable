import { errorRequestHandler } from '../context';

type IRequestFunction<T extends unknown[], R> = (...args: T) => R;

export function requestWrap<T extends unknown[], R>(
  fn: IRequestFunction<T, Promise<R>>
): IRequestFunction<T, Promise<R>> {
  return (...args: T) => {
    return new Promise((resolve, reject) => {
      fn(...args)
        .then((res) => resolve(res))
        .catch((err) => {
          errorRequestHandler(err);
          reject(err);
        });
    });
  };
}
