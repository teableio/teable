import type { IFieldVo, ITableVo } from '@teable-group/core';
import type { IGetBaseVo } from '@teable-group/openapi';
import { ssrApi } from '@/backend/api/rest/table.ssr';

export interface IDesignPageProps {
  baseServerData: IGetBaseVo;
  tableServerData: ITableVo[];
  fieldServerData: IFieldVo[];
}

export const getDesignPageServerData = async (
  baseId: string,
  tableId: string
): Promise<IDesignPageProps | undefined> => {
  const api = ssrApi;
  const tableResult = await api.getTable(baseId, tableId);
  if (tableResult) {
    const base = await ssrApi.getBaseById(baseId);
    const tablesResult = await api.getTables(baseId);
    const fieldsResult = await api.getFields(tableId);
    return {
      tableServerData: tablesResult,
      baseServerData: base,
      fieldServerData: fieldsResult,
    };
  }
  return undefined;
};
