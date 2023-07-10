import { useContext } from 'react';
import { AnchorContext } from '../context';
import { ViewContext } from '../context/view';

export function useView() {
  const { viewId } = useContext(AnchorContext);
  const { views } = useContext(ViewContext);
  return views.find((view) => view.id === viewId);
}
