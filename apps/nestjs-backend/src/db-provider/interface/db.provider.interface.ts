import type { ITopoLinkOrder } from '../../features/calculation/reference.service';

export interface IDbProvider {
  affectedRecordItemsQuerySql(
    topoOrder: ITopoLinkOrder[],
    originRecordIdItems: { dbTableName: string; id: string }[]
  ): string;
}
