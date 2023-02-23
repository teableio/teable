// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function has<T extends object>(obj: T, key: keyof any): key is keyof T {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Allows creating an object map type with a dynamic key type.
 *
 * TypeScript only allows `string` for `K` in `{[key: K]: V}` so we need a utility to bridge
 * the gap.
 *
 * This is an alias for TypeScript’s `Record` type, but the name “record” is confusing given our
 * Teable domain model.
 *
 * @hidden
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IObjectMap<K extends keyof any, V> = { [P in K]: V };

function keys<Obj extends object>(obj: Obj): Array<keyof Obj> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.keys(obj) as any;
}

export function getEnumValueIfExists<K extends string, V extends string>(
  enumObj: IObjectMap<K, V>,
  valueToCheck: string
): V | null {
  const invertedEnum = getInvertedEnumMemoized(enumObj);
  if (has(invertedEnum, valueToCheck) && invertedEnum[valueToCheck]) {
    const enumKey = invertedEnum[valueToCheck];
    return enumObj[enumKey];
  }
  return null;
}

const invertedEnumCache: WeakMap<object, object> = new WeakMap();
/**
 * @hidden
 */
function getInvertedEnumMemoized<K extends string, V extends string>(
  enumObj: IObjectMap<K, V>
): IObjectMap<V, K> {
  const existingInvertedEnum = invertedEnumCache.get(enumObj);
  if (existingInvertedEnum) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return existingInvertedEnum as any;
  }

  const invertedEnum = {} as IObjectMap<V, K>;
  for (const enumKey of keys(enumObj)) {
    const enumValue = enumObj[enumKey];
    invertedEnum[enumValue] = enumKey;
  }
  invertedEnumCache.set(enumObj, invertedEnum);
  return invertedEnum;
}
