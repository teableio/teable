import { useContext } from 'react';
import { BaseFilterContext } from '../context';

export const useComponent = () => {
  const { component } = useContext(BaseFilterContext);

  return {
    ...component,
  };
};
