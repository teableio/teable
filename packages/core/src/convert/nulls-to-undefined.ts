/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IRecursivelyReplaceNullWithUndefined } from '../types';

export function nullsToUndefined<T>(obj: T): IRecursivelyReplaceNullWithUndefined<T> {
  if (obj == null) {
    return undefined as any;
  }

  // object check based on: https://stackoverflow.com/a/51458052/6489012
  if (obj.constructor.name === 'Object') {
    for (const key in obj) {
      obj[key] = nullsToUndefined(obj[key]) as any;
    }
  }
  return obj as any;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function nullsToUndefinedShallow<T>(obj: T): IRecursivelyReplaceNullWithUndefined<T> {
  if (obj == null) {
    return undefined as any;
  }

  // object check based on: https://stackoverflow.com/a/51458052/6489012
  if (obj.constructor.name === 'Object') {
    for (const key in obj) {
      obj[key] = obj[key] == null ? undefined : (obj[key] as any);
    }
  }
  return obj as any;
}
