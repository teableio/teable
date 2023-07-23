import { useContext } from 'react';
import { ViewContext } from '../context';

export function useView(viewId?: string) {
  const { views } = useContext(ViewContext);
  return views.find((view) => view.id === viewId);
}
