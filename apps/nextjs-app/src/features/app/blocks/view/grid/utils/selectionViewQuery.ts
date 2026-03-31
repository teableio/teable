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
}: {
  personalViewCommonQuery?: ISelectionViewQuery;
}): ISelectionViewQuery | undefined => {
  if (!personalViewCommonQuery) {
    return;
  }

  return personalViewCommonQuery;
};
