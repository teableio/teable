import { isNonEmptyString } from '../typeguards';

type IMsgOrErrorFactory = string | (() => Error);

export function assertNonEmptyString(
  v: unknown,
  msgOrErrorFactory?: IMsgOrErrorFactory,
  /** auto-trim, default true */
  trim?: boolean
): asserts v is string {
  if (!isNonEmptyString(v, trim ?? true)) {
    throw createAssertException(msgOrErrorFactory);
  }
}

export function assertIncludes<T extends string[]>(
  v: string | undefined,
  stringArray: T,
  msgOrErrorFactory?: IMsgOrErrorFactory,
  caseInsensitive?: boolean
): asserts v is T[number] {
  const insensitive = caseInsensitive ?? false;
  const val = insensitive ? v?.toUpperCase() : v;
  const allowed = insensitive ? stringArray.map((v) => v.toUpperCase()) : stringArray;
  if (!val || !allowed.includes(val)) {
    const msg = [
      `Value '${v ? v : typeof v}' is not in allowed values`,
      `(${stringArray.join(',')}`,
      insensitive ? '(case insensitive).' : '(case sensitive).',
    ].join(',');
    throw createAssertException(msgOrErrorFactory, msg);
  }
}

export function assertIsPresent<T>(
  v: T,
  msgOrErrorFactory?: IMsgOrErrorFactory
): asserts v is NonNullable<T> {
  if (v === null || v === undefined) {
    throw createAssertException(msgOrErrorFactory, 'Value is null or undefined.');
  }
}

export function assertSafeInteger(
  v: unknown,
  msgOrErrorFactory?: IMsgOrErrorFactory
): asserts v is number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw createAssertException(msgOrErrorFactory, 'Value is not a safe integer BILOUTEBILL');
  }
}

function createAssertException(msgOrErrorFactory?: string | (() => Error), fallbackMsg?: string) {
  if (typeof msgOrErrorFactory === 'string' || msgOrErrorFactory === undefined) {
    throw new Error(msgOrErrorFactory ?? fallbackMsg ?? 'Assertion did not pass.');
  }
  throw msgOrErrorFactory();
}

/**
 * Helper function for exhaustive checks of discriminated unions.
 * https://basarat.gitbooks.io/typescript/docs/types/discriminated-unions.html
 *
 * @example
 *
 *    type A = {type: 'a'};
 *    type B = {type: 'b'};
 *    type Union = A | B;
 *
 *    function doSomething(arg: Union) {
 *      if (arg.type === 'a') {
 *        return something;
 *      }
 *
 *      if (arg.type === 'b') {
 *        return somethingElse;
 *      }
 *
 *      // TS will error if there are other types in the union
 *      // Will throw an Error when called at runtime.
 *      // Use `assertNever(arg, true)` instead to fail silently.
 *      return assertNever(arg);
 *    }
 */
export function assertNever(value: never, noThrow?: boolean): never {
  if (noThrow) {
    return value;
  }

  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`);
}
