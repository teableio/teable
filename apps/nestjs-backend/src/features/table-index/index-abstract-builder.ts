import type { IGetAbnormalVo, ITableQueryIndexSpec } from '@teable/openapi';
import type { ITableIndexField } from './table-index-field';

export abstract class IndexBuilderAbstract {
  abstract getDropIndexSql(dbTableName: string): string;

  abstract getCreateIndexSql(dbTableName: string, searchFields: ITableIndexField[]): string[];

  abstract getExistTableIndexSql(dbTableName: string): string;

  abstract getDeleteSingleIndexSql(dbTableName: string, field: ITableIndexField): string;

  abstract getUpdateSingleIndexNameSql(
    dbTableName: string,
    oldField: Pick<ITableIndexField, 'id' | 'dbFieldName'>,
    newField: Pick<ITableIndexField, 'id' | 'dbFieldName'>
  ): string;

  abstract createSingleIndexSql(dbTableName: string, field: ITableIndexField): string | null;

  abstract getIndexInfoSql(dbTableName: string): string;

  abstract getAbnormalIndex(
    dbTableName: string,
    fields: ITableIndexField[],
    existingIndex: unknown[]
  ): IGetAbnormalVo;

  abstract getQueryIndexInfoSql(dbTableName: string): string;

  abstract getDropQueryIndexesSql(dbTableName: string): string;

  abstract getQueryIndexName(
    tableId: string,
    indexId: string,
    unavailableNames?: ReadonlySet<string>
  ): string;

  abstract getQueryIndexId(indexName: string): string | undefined;

  abstract createQueryIndexSql(
    dbTableName: string,
    index: ITableQueryIndexSpec,
    fieldNamesById: Map<string, string>,
    tableId: string,
    indexName?: string
  ): string;
}
