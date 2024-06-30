import { useContext } from 'react';
import { FilterContext } from '../context';

export const useCompact = () => {
  const result = useContext(FilterContext) || {};
  const { compact } = result;
  return !!compact;
};
