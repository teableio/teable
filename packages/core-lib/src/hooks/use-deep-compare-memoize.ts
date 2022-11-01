import { dequal } from 'dequal';
import { useRef } from 'react';

type SupportedValue =
  | Record<string, unknown>
  | string
  | boolean
  | number
  | null;

export function useDeepCompareMemoize(value: SupportedValue): SupportedValue {
  const ref = useRef<SupportedValue>(null);
  if (!dequal(value, ref.current)) {
    ref.current = value;
  }
  return ref.current;
}
