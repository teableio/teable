import type { ITableFieldPersistenceDTO } from '@teable/v2-core';

export type ITableDbFieldMeta = {
  field: ITableFieldPersistenceDTO;
  dbFieldName: string;
};

export type ITableDbMeta = {
  tableId: string;
  dbTableName: string;
  fields: ReadonlyArray<ITableDbFieldMeta>;
};
