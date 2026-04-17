const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

const markVisitedPair = (
  visited: WeakMap<object, WeakSet<object>>,
  left: object,
  right: object
): boolean => {
  const seenRightValues = visited.get(left);
  if (seenRightValues?.has(right)) {
    return true;
  }

  if (seenRightValues) {
    seenRightValues.add(right);
  } else {
    visited.set(left, new WeakSet([right]));
  }
  return false;
};

const areValuesEqual = (
  left: unknown,
  right: unknown,
  visited: WeakMap<object, WeakSet<object>>
): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (left == null && right == null) {
    return true;
  }
  if (!isObject(left) || !isObject(right)) {
    return false;
  }
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => areValuesEqual(item, right[index], visited));
  }
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) {
    return false;
  }
  if (Object.getPrototypeOf(left) !== Object.prototype && Object.getPrototypeOf(left) !== null) {
    return false;
  }
  if (markVisitedPair(visited, left, right)) {
    return true;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) {
      return false;
    }
    if (!areValuesEqual(leftRecord[key], rightRecord[key], visited)) {
      return false;
    }
  }
  return true;
};

export const areRecordFieldValuesEqual = (left: unknown, right: unknown): boolean =>
  areValuesEqual(left, right, new WeakMap());
