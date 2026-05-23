import type { IGetRecordsRo, IRangesToIdQuery } from '@teable/openapi';
import { IdReturnType, RangeType } from '@teable/openapi';
import type { IRange } from '../../grid';

export const buildLinkRangeToIdQuery = (
  ranges: IRange[],
  recordQuery?: IGetRecordsRo,
  viewId?: string
): IRangesToIdQuery => {
  const {
    search,
    filter,
    filterByTql,
    filterLinkCellCandidate,
    filterLinkCellSelected,
    selectedRecordIds,
    ignoreViewQuery,
    orderBy,
    groupBy,
    collapsedGroupIds,
    queryId,
    viewId: recordQueryViewId,
  } = recordQuery ?? {};

  return {
    ranges,
    type: RangeType.Rows,
    returnType: IdReturnType.RecordId,
    viewId: recordQueryViewId ?? viewId,
    search,
    filter,
    filterByTql,
    filterLinkCellCandidate,
    filterLinkCellSelected,
    selectedRecordIds,
    ignoreViewQuery,
    orderBy,
    groupBy,
    collapsedGroupIds,
    queryId,
  };
};
