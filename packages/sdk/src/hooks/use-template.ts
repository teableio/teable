import { useContext } from 'react';
import { AppContext } from '../context';

export const useTemplate = () => {
  const { template } = useContext(AppContext) || {};
  return template;
};
