import type { IFieldVo, IRecord, ITableVo, IViewVo } from '@teable-group/core';
import type { BaseSchema } from '@teable-group/openapi';
import { ssrApi } from '@/backend/api/rest/table.ssr';

export interface IViewPageProps {
  baseServerData: BaseSchema.IGetBaseVo;
  tableServerData: ITableVo[];
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordsServerData: { records: IRecord[] };
}

export const getViewPageServerData = async (
  baseId: string,
  nodeId: string,
  viewId: string
): Promise<IViewPageProps | undefined> => {
  const api = ssrApi;
  const tableResult = await api.getTable(baseId, nodeId, viewId);
  if (tableResult) {
    const base = await ssrApi.getBaseById(baseId);
    const tablesResult = await api.getTables(baseId);
    const { fields, views, records } = tableResult;
    return {
      baseServerData: base,
      tableServerData: tablesResult,
      fieldServerData: fields,
      viewServerData: views,
      recordsServerData: { records },
    };
  }
  return undefined;
};
