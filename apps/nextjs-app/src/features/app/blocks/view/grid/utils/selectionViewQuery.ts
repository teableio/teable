import type { IGetRecordsRo } from '@teable/openapi';

type ISelectionViewQuery = Pick<
  IGetRecordsRo,
  'ignoreViewQuery' | 'filter' | 'orderBy' | 'groupBy' | 'projection'
>;

/**
 * When a personal view is active, always pass the full query (including
 * ignoreViewQuery) so the backend uses the same sort/filter/group as the
 * frontend.
 */
export const buildSelectionViewQuery = ({
  personalViewCommonQuery,
  visibleFieldIds,
}: {
  personalViewCommonQuery?: ISelectionViewQuery;
  visibleFieldIds?: string[];
}): ISelectionViewQuery | undefined => {
  const projection = visibleFieldIds?.length
    ? visibleFieldIds
    : personalViewCommonQuery?.projection;

  if (!personalViewCommonQuery) {
    if (projection?.length) {
      return { projection };
    }
    return;
  }

  return {
    ...personalViewCommonQuery,
    projection,
  };
};
