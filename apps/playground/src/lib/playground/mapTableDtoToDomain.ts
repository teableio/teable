import {
  DefaultTableMapper,
  err,
  Result,
  type ITablePersistenceDTO,
  type Table,
} from '@teable/v2-core';
import type { ITableDto } from '@teable/v2-contract-http';

const defaultTableMapper = new DefaultTableMapper();

const stripPrimaryFlag = (fields: ITableDto['fields']): ITablePersistenceDTO['fields'] =>
  fields.map(({ isPrimary, ...rest }) => rest as ITablePersistenceDTO['fields'][number]);

export const mapTableDtoToDomain = (table: ITableDto): Result<Table, string> => {
  const primaryField = table.fields.find((field) => field.isPrimary);
  if (!primaryField) return err('Primary field missing in table dto');

  const persistenceDto: ITablePersistenceDTO = {
    id: table.id,
    baseId: table.baseId,
    name: table.name,
    dbTableName: table.dbTableName,
    primaryFieldId: primaryField.id,
    fields: stripPrimaryFlag(table.fields),
    views: table.views,
  };

  return defaultTableMapper.toDomain(persistenceDto);
};
