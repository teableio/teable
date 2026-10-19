export interface ISsrAnchorState {
  tableId: string;
  viewId: string;
  /** Whether the page-load server snapshot still describes the live anchor. */
  fresh: boolean;
}

export const createSsrAnchorState = (tableId: string, viewId: string): ISsrAnchorState => ({
  tableId,
  viewId,
  fresh: true,
});

/**
 * getServerSideProps runs once per document load; every later table/view
 * navigation is a shallow route change that keeps the same props. The snapshot
 * is therefore authoritative only while the anchor has never moved. Returning
 * to the page-load anchor later does not make it fresh again — its rows,
 * group structure and view config describe the moment of the load, so the
 * bounded seed query must bootstrap from then on.
 */
export const updateSsrAnchorState = (
  state: ISsrAnchorState,
  tableId: string,
  viewId: string
): ISsrAnchorState =>
  state.tableId === tableId && state.viewId === viewId ? state : { tableId, viewId, fresh: false };

export interface ISeedCollapseState {
  anchor: string;
  ids?: string[];
}

/**
 * The bootstrap seed must describe the layout the user arrived with. After
 * that the grid patches collapse/expand locally and the live delivery owns the
 * structure, so keeping the seed query keyed by later toggles would only
 * refetch responses the providers discard.
 */
export const captureAnchorCollapseState = (
  previous: ISeedCollapseState,
  anchor: string,
  ids: string[] | undefined
): ISeedCollapseState => (previous.anchor === anchor ? previous : { anchor, ids });
