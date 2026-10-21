/**
 * Whether the anchored view is missing from the loaded view list — i.e. the
 * anchor is *suspected* stale. This is only a suspicion: the list can lag
 * reality in both directions (a just-created view has not arrived yet, a
 * just-deleted one has not left yet), so the caller must confirm against the
 * HTTP view list before acting on it.
 */
export const isStaleViewAnchor = (props: {
  views: { id: string; tableId?: string }[];
  tableId?: string;
  viewId?: string;
}): boolean => {
  const { views, tableId, viewId } = props;
  if (!tableId || !viewId || views.length === 0) return false;
  // Mid table-switch the provider can briefly still hold the previous
  // table's instances — never judge the anchor against those.
  if (views.some((view) => view.tableId !== tableId)) return false;
  return !views.some((view) => view.id === viewId);
};

/**
 * Query param that getServerSideProps sets when it drops a dead view anchor
 * from the URL (see getTableServerSideProps). A full page load is validated
 * server side and redirected before anything renders, so the client would
 * otherwise have no way to tell that the view it shows is not the view the
 * URL asked for — which is exactly the misleading case for a shared link.
 * Its value is the id of the view that no longer exists.
 */
export const STALE_VIEW_PARAM = 'staleViewId';
