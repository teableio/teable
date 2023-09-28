import type { IOpsData } from '../../features/calculation/batch.service';
import type { ITopoLinkOrder } from '../../features/calculation/reference.service';
import type { IFieldInstance } from '../../features/field/model/factory';

export interface IDbProvider {
  batchInsertSql(tableName: string, insertData: ReadonlyArray<unknown>): string;

  affectedRecordItemsQuerySql(
    topoOrder: ITopoLinkOrder[],
    originRecordIdItems: { dbTableName: string; id: string }[]
  ): string;

  executeUpdateRecordsSqlList(params: {
    dbTableName: string;
    fieldMap: { [fieldId: string]: IFieldInstance };
    opsData: IOpsData[];
    tempTableName: string;
    columnNames: string[];
    userId: string;
  }): { insertTempTableSql: string; updateRecordSql: string };
}
