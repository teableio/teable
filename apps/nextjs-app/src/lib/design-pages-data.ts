import type { IGetBaseVo, ITableVo } from '@teable/openapi';
import type { SsrApi } from '@/backend/api/rest/table.ssr';

export interface IDesignPageProps {
  baseServerData: IGetBaseVo;
  tableServerData: ITableVo[];
}

export const getDesignPageServerData = async (
  ssrApi: SsrApi,
  baseId: string
): Promise<IDesignPageProps> => {
  const api = ssrApi;
  const base = await api.getBaseById(baseId);
  const tablesResult = await api.getTables(baseId);
  return {
    tableServerData: tablesResult,
    baseServerData: base,
  };
};
