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
    const base = (await api.getBaseById(baseId)).data;
    const tablesResult = (await api.getTables(baseId)).data;
    const fieldsResult = (await api.getFields(tableId)).data;
    return {
      tableServerData: tablesResult,
      baseServerData: base,
      fieldServerData: fieldsResult,
    };
  }
  return undefined;
};
