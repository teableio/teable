/**
 * Append items without `target.push(...items)`.
 *
 * Spreading a large array as function arguments overflows V8's call stack
 * (`RangeError: Maximum call stack size exceeded`). Looping stays O(n) and
 * stays within a fixed stack frame. See T2511 / T6713.
 */
export const pushAll = <T>(target: T[], items: Iterable<T>): T[] => {
  for (const item of items) {
    target.push(item);
  }
  return target;
};
