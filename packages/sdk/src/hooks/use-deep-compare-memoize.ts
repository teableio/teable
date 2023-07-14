import { dequal } from 'dequal';
import { useRef } from 'react';

type ISupportedValue = Record<string, unknown> | string | boolean | number | null;

export function useDeepCompareMemoize(value: ISupportedValue): ISupportedValue {
  const ref = useRef<ISupportedValue>(null);
  if (!dequal(value, ref.current)) {
    ref.current = value;
  }
  return ref.current;
}
