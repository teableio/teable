import type { IFilter } from '@teable/core';
import { useContext } from 'react';
import { AnchorContext } from '../context/anchor';
import { ShareViewContext } from '../context/table/ShareViewContext';
import { useView } from './use-view';

/**
 * The effective view filter applied server-side to a view query, used to gate
 * record-op refreshes (its referenced fields stay "relevant"). Outside share
 * this is the active view's own filter. In share the proxied view carries only
 * the visitor's local filter, so the shared view's stored filter is read from
 * ShareViewContext instead. This only gates refreshes — over-inclusion merely
 * costs an extra refetch, so precision is not required here.
 */
export const useServerViewFilter = (): IFilter | undefined => {
  const { viewId } = useContext(AnchorContext);
  const { shareId, view: shareServerView } = useContext(ShareViewContext);
  const view = useView(viewId);
  const shareViewFilter = shareServerView?.id === viewId ? shareServerView?.filter : undefined;
  return (shareId ? shareViewFilter : view?.filter) as IFilter | undefined;
};
