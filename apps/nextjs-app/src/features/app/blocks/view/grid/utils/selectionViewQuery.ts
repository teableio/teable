import type { IGetRecordsRo } from '@teable/openapi';

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
