import { useContext } from 'react';
import { ViewContext } from '../context/view';

export function useViews() {
  const { views } = useContext(ViewContext);
  return views;
}
