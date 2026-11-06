import type { IViewVo } from '@teable/core';
import type { IGetRecordsRo, IRangesRo } from '@teable/openapi';

type ISelectionViewQuery = Pick<
  IGetRecordsRo,
  'ignoreViewQuery' | 'filter' | 'orderBy' | 'groupBy' | 'projection'
>;

/**
 * When a personal view is active, always pass the full query (including
 * ignoreViewQuery) so the backend uses the same sort/filter/group as the
 * frontend, plus the live visible projection to keep selection column indexes
 * in sync.
 *
 * For a normal (server-side) view we intentionally omit `projection`: the
 * backend already knows the view's visible fields/order, so sending the full
 * field list is redundant and bloats the request query string. With many
 * fields it overflows the URL length limit and selection operations such as
 * delete fail with `414 Request URI Too Large`. See T4797.
 */
export const buildSelectionViewQuery = ({
  personalViewCommonQuery,
  visibleFieldIds,
}: {
  personalViewCommonQuery?: ISelectionViewQuery;
  visibleFieldIds?: string[];
}): ISelectionViewQuery | undefined => {
  if (!personalViewCommonQuery) {
    return;
  }

  const projection = visibleFieldIds?.length ? visibleFieldIds : personalViewCommonQuery.projection;

  return {
    ...personalViewCommonQuery,
    projection,
  };
};

export const getSelectionGroupBy = ({
  selectionViewQuery,
  viewGroup,
}: {
  selectionViewQuery?: ISelectionViewQuery;
  viewGroup?: ISelectionViewQuery['groupBy'];
}) => (selectionViewQuery ? selectionViewQuery.groupBy : viewGroup);

/** Shared-view coordinates follow the visitor's proxy view, not personal-view state.
 * The dedicated endpoint still applies the owner's stored visibility/filter constraints.
 */
export const buildSharedViewCopyRequest = ({
  shareViewId,
  rangesRo,
  proxyView,
  visibleFieldIds,
}: {
  shareViewId?: string;
  rangesRo: IRangesRo;
  proxyView?: Pick<IViewVo, 'filter' | 'sort' | 'group'>;
  visibleFieldIds: string[];
}) => {
  // Base-share IDs deliberately never enter this helper: only ShareViewContext supplies this ID.
  if (!shareViewId) return;
  const query: IRangesRo = {
    ranges: rangesRo.ranges,
    type: rangesRo.type,
    filterByTql: rangesRo.filterByTql,
    filter: proxyView?.filter,
    orderBy: proxyView?.sort?.manualSort ? [] : proxyView?.sort?.sortObjs,
    groupBy: proxyView?.group,
    projection: visibleFieldIds,
    search: rangesRo.search,
    collapsedGroupIds: rangesRo.collapsedGroupIds,
    queryId: rangesRo.queryId,
  };
  return { shareId: shareViewId, query };
};
