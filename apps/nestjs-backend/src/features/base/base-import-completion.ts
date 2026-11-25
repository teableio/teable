import type { IBaseJson } from '@teable/openapi';

/** Awaited after every row, junction and computed backfill of an import has succeeded. */
export const BASE_IMPORT_DATA_COMPLETE = 'base.import.data.complete';
export const BASE_IMPORT_DATA_STATUS = 'base.import.data.status';

export interface IBaseImportDataComplete {
  baseId: string;
  operationId: string;
  userId: string;
  structure: IBaseJson;
  tableIdMap: Record<string, string>;
  fieldIdMap: Record<string, string>;
  viewIdMap: Record<string, string>;
  hostResourceIdMaps: Record<string, Record<string, string>>;
}
