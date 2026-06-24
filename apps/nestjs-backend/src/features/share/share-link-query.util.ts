/**
 * A link "selection" query loads records that are already linked or explicitly chosen
 * (via `filterLinkCellSelected` or `selectedRecordIds`), as opposed to the candidate
 * list of records available to be newly linked (`filterLinkCellCandidate`).
 *
 * The link field's view scope (`filterByViewId`) and configured filter only constrain
 * the candidate list, so selection queries must NOT be filtered by them — otherwise an
 * already-linked record that falls outside the configured view disappears (renders
 * blank / rowCount 0). See T4864.
 *
 * Note: `selectedRecordIds` combined with `filterLinkCellCandidate` is the "exclude
 * these from the candidate list" case, which must keep the view scope.
 */
export const isLinkRecordSelectionQuery = (query?: {
  filterLinkCellSelected?: unknown;
  filterLinkCellCandidate?: unknown;
  selectedRecordIds?: string[];
}): boolean =>
  Boolean(query?.filterLinkCellSelected) ||
  (Boolean(query?.selectedRecordIds?.length) && !query?.filterLinkCellCandidate);
