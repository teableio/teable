import type { ILinkFieldOptions } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';

export const buildLinkRecordQueryBase = (
  options: Pick<ILinkFieldOptions, 'filterByViewId' | 'visibleFieldIds'>
): Pick<IGetRecordsRo, 'projection' | 'viewId'> => ({
  ...(options.filterByViewId ? { viewId: options.filterByViewId } : {}),
  ...(options.visibleFieldIds?.length ? { projection: options.visibleFieldIds } : {}),
});
