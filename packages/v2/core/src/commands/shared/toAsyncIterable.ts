export const isAsyncIterable = <T>(
  value: Iterable<T> | AsyncIterable<T>
): value is AsyncIterable<T> =>
  typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function';

export async function* toAsyncIterable<T>(
  source: Iterable<T> | AsyncIterable<T>
): AsyncIterable<T> {
  if (isAsyncIterable(source)) {
    yield* source;
    return;
  }

  for (const item of source) {
    yield item;
  }
}
