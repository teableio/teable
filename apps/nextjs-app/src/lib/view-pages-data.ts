import type { IFieldVo, IRecord, ITableVo, IViewVo } from '@teable-group/core';
import { ssrApi } from '@/backend/api/rest/table.ssr';

export interface IViewPageProps {
  tableServerData: ITableVo[];
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordsServerData: { records: IRecord[] };
}

export const getViewPageServerData = async (
  nodeId: string,
  viewId: string
): Promise<IViewPageProps | undefined> => {
  const api = ssrApi;
  const tableResult = await api.getTable(nodeId as string, viewId as string);
  if (tableResult) {
    const tablesResult = await api.getTables();
    const { fields, views, records } = tableResult;
    return {
      tableServerData: tablesResult,
      fieldServerData: fields,
      viewServerData: views,
      recordsServerData: { records },
    };
  }
  return undefined;
};
