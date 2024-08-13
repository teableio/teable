import { useContext } from 'react';
import { ViewFilterContext } from '../context';

export const useFields = () => {
  const { fields } = useContext(ViewFilterContext);

  return fields;
};
