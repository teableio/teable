import { useContext } from 'react';
import { BaseFilterContext } from '../context';

export const useDepth = () => {
  const { maxDepth = 2 } = useContext(BaseFilterContext);
  return maxDepth;
};
