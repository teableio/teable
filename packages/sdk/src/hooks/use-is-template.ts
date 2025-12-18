import { useContext } from 'react';
import { AppContext } from '../context';

export const useIsTemplate = () => {
  const { template } = useContext(AppContext) || {};
  return !!template;
};
