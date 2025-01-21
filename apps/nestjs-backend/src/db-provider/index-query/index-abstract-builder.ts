import type { IGetAbnormalVo } from '@teable/openapi';
import type { IFieldInstance } from '../../features/field/model/factory';

export abstract class IndexBuilderAbstract {
  abstract getDropIndexSql(dbTableName: string): string;

  abstract getCreateIndexSql(dbTableName: string, searchFields: IFieldInstance[]): string[];

  abstract getExistTableIndexSql(dbTableName: string): string;

  abstract getDeleteSingleIndexSql(dbTableName: string, field: IFieldInstance): string;

  abstract getUpdateSingleIndexNameSql(
    dbTableName: string,
    oldField: Pick<IFieldInstance, 'id' | 'dbFieldName'>,
    newField: Pick<IFieldInstance, 'id' | 'dbFieldName'>
  ): string;

  abstract createSingleIndexSql(dbTableName: string, field: IFieldInstance): string | null;

  abstract getIndexInfoSql(dbTableName: string): string;

  abstract getAbnormalIndex(
    dbTableName: string,
    fields: IFieldInstance[],
    existingIndex: unknown[]
  ): IGetAbnormalVo;
}
