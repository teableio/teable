import { ViewContext } from '../context/view';
import { useContext } from 'react';

export function useViews() {
  const { views } = useContext(ViewContext);
  return views;
}
