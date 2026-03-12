import type { IGetRecordsRo } from '@teable/openapi';
import { isEqual } from 'lodash';

type IViewQueryLike = {
  filter?: IGetRecordsRo['filter'];
  sort?: { sortObjs?: IGetRecordsRo['orderBy'] } | null;
  group?: IGetRecordsRo['groupBy'];
};

type ISelectionViewQuery = Pick<
  IGetRecordsRo,
  'ignoreViewQuery' | 'filter' | 'orderBy' | 'groupBy' | 'projection'
>;

/**
 * Personal views always carry ignoreViewQuery=true, but selection APIs only need that
 * flag when the personal view actually changes row-targeting query state.
 */
export const buildSelectionViewQuery = ({
  view,
  personalViewCommonQuery,
}: {
  view?: IViewQueryLike;
  personalViewCommonQuery?: ISelectionViewQuery;
}): ISelectionViewQuery | undefined => {
  if (!personalViewCommonQuery) {
    return;
  }

  const { ignoreViewQuery, filter, orderBy, groupBy, projection } = personalViewCommonQuery;
  if (!ignoreViewQuery) {
    return personalViewCommonQuery;
  }

  const hasQueryDifference =
    !isEqual(filter ?? null, view?.filter ?? null) ||
    !isEqual(orderBy, view?.sort?.sortObjs) ||
    !isEqual(groupBy, view?.group);

  if (hasQueryDifference) {
    return personalViewCommonQuery;
  }

  return projection ? { projection } : undefined;
};
