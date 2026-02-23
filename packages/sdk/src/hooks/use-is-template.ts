import { useContext } from 'react';
import { AppContext } from '../context';

export const useIsTemplate = () => {
  const { template } = useContext(AppContext) || {};
  // Return true for both template and share mode (both are read-only previews)
  return !!template;
};
