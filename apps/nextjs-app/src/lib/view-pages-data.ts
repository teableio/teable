import type { IFieldVo, IRecord, ITableVo, IViewVo } from '@teable-group/core';
import { SsrApi } from '@/backend/api/rest/table.ssr';

export interface IViewPageProps {
  tableServerData: ITableVo[];
  fieldServerData: IFieldVo[];
  viewServerData: IViewVo[];
  recordsServerData: { records: IRecord[]; total: number };
}

export const getViewPageServerData = async (
  nodeId: string,
  viewId: string
): Promise<IViewPageProps | undefined> => {
  const api = new SsrApi();
  const tableResult = await api.getTable(nodeId as string, viewId as string);
  if (tableResult.success) {
    const tablesResult = await api.getTables();
    const { fields, views, records, total } = tableResult.data;
    return {
      tableServerData: tablesResult.success ? tablesResult.data : [],
      fieldServerData: fields,
      viewServerData: views,
      recordsServerData: { records, total },
    };
  }
  return undefined;
};
