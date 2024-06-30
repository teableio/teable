import { useContext } from 'react';
import { FilterDisplayContext } from '../context';

export const useCompact = () => {
  const result = useContext(FilterDisplayContext) || {};
  const { compact } = result;
  return !!compact;
};
