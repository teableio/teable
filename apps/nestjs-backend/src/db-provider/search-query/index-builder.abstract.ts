import type { IFieldInstance } from '../../features/field/model/factory';

export abstract class IndexBuilderAbstract {
  abstract getDropIndexSql(dbTableName: string): string;

  abstract getCreateIndexSql(dbTableName: string, searchFields: IFieldInstance[]): string[];

  abstract getExistTableIndexSql(dbTableName: string): string;
}
