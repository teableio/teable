import { useContext } from 'react';
import { ViewFilterContext } from '../context';

export const useViewFilterContext = () => {
  const { viewFilterLinkContext } = useContext(ViewFilterContext);

  return viewFilterLinkContext;
};
