import type { FieldCore } from '@teable/core';
import { getValidFilterOperators } from '@teable/core';
import { useMemo } from 'react';

export const useOperators = (field?: FieldCore) => {
  return useMemo(() => {
    if (!field) {
      return [];
    }
    return getValidFilterOperators(field);
  }, [field]);
};
