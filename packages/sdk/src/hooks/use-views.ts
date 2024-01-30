import { useContext } from 'react';
import { ViewContext } from '../context/view';

export function useViews() {
  const viewCtx = useContext(ViewContext);
  return viewCtx?.views;
}
