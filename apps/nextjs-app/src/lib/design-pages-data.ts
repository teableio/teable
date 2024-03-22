import type { IFieldVo } from '@teable/core';
import type { IGetBaseVo, ITableVo } from '@teable/openapi';
import type { SsrApi } from '@/backend/api/rest/table.ssr';

export interface IDesignPageProps {
  baseServerData: IGetBaseVo;
  tableServerData: ITableVo[];
  fieldServerData: IFieldVo[];
}

export const getDesignPageServerData = async (
  ssrApi: SsrApi,
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
