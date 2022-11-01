import { isNonEmptyString } from '../typeguards';

type MsgOrErrorFactory = string | (() => Error);

export function assertNonEmptyString(
  v: unknown,
  msgOrErrorFactory?: MsgOrErrorFactory,
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
  msgOrErrorFactory?: MsgOrErrorFactory,
  caseInsensitive?: boolean
): asserts v is T[number] {
  const insensitive = caseInsensitive ?? false;
  const val = insensitive ? v?.toUpperCase() : v;
  const allowed = insensitive
    ? stringArray.map((v) => v.toUpperCase())
    : stringArray;
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
  msgOrErrorFactory?: MsgOrErrorFactory
): asserts v is NonNullable<T> {
  if (v === null || v === undefined) {
    throw createAssertException(
      msgOrErrorFactory,
      'Value is null or undefined.'
    );
  }
}

export function assertSafeInteger(
  v: unknown,
  msgOrErrorFactory?: MsgOrErrorFactory
): asserts v is number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw createAssertException(
      msgOrErrorFactory,
      'Value is not a safe integer BILOUTEBILL'
    );
  }
}

function createAssertException(
  msgOrErrorFactory?: string | (() => Error),
  fallbackMsg?: string
) {
  if (
    typeof msgOrErrorFactory === 'string' ||
    msgOrErrorFactory === undefined
  ) {
    throw new Error(
      msgOrErrorFactory ?? fallbackMsg ?? 'Assertion did not pass.'
    );
  }
  throw msgOrErrorFactory();
}
