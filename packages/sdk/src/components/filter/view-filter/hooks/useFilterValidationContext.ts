import type { IFilterValidationError } from '@teable/core';
import { createContext, useContext } from 'react';
import type { IFilterPath } from '../../types';

export const FilterValidationContext = createContext<IFilterValidationError[]>([]);

const normalizeFilterPath = (path: IFilterPath | number[]): number[] => {
  return path.reduce<number[]>((acc, segment) => {
    if (typeof segment === 'number') {
      acc.push(segment);
    }
    return acc;
  }, []);
};

const isSamePath = (path1: number[], path2: number[]) =>
  path1.length === path2.length && path1.every((segment, index) => segment === path2[index]);

export const useFilterItemError = (path: IFilterPath) => {
  const errors = useContext(FilterValidationContext);
  const normalizedPath = normalizeFilterPath(path);
  return errors.find((error) => isSamePath(error.path, normalizedPath));
};
