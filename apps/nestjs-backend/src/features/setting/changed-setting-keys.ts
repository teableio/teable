import { isEqual, isPlainObject } from 'lodash';

/**
 * Dot paths of the leaves that differ between two setting values, for audit rows about
 * secret-bearing configuration (SMTP, IM bots, AI providers): the row may name WHICH keys an
 * admin changed, never their values. Plain objects are walked; anything else (arrays included)
 * is compared as a whole, so `llmProviders` reports as one key. A missing value equals `null`.
 */
export const collectChangedKeys = (before: unknown, after: unknown, path = ''): string[] => {
  if (isPlainObject(before) || isPlainObject(after)) {
    const beforeObject = (isPlainObject(before) ? before : {}) as Record<string, unknown>;
    const afterObject = (isPlainObject(after) ? after : {}) as Record<string, unknown>;
    const keys = new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]);
    return [...keys].flatMap((key) =>
      collectChangedKeys(beforeObject[key], afterObject[key], path ? `${path}.${key}` : key)
    );
  }
  return isEqual(before ?? null, after ?? null) ? [] : [path];
};

/**
 * The keys a partial settings patch actually changes, each walked with
 * {@link collectChangedKeys}. Keys the patch leaves `undefined` are not written, so they are
 * not changes either.
 */
export const collectChangedPatchKeys = (
  before: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>
): string[] =>
  Object.keys(patch)
    .filter((key) => patch[key] !== undefined)
    .flatMap((key) => collectChangedKeys(before?.[key], patch[key], key));
