import { CellValueType, DbFieldType, FieldType, getRandomString } from '@teable/core';
import { BaseQueryColumnType } from '@teable/openapi';
import type { IFieldInstance } from '../../../field/model/factory';
import { createFieldInstanceByRaw } from '../../../field/model/factory';

// eslint-disable-next-line @typescript-eslint/naming-convention
const AGGREGATION_FIELD_INSTANCE_DESC = getRandomString(10);

export const getQueryColumnTypeByFieldInstance = (field: IFieldInstance): BaseQueryColumnType => {
  if (field.description === AGGREGATION_FIELD_INSTANCE_DESC) {
    return BaseQueryColumnType.Aggregation;
  }
  return BaseQueryColumnType.Field;
};

export const createBaseQueryFieldInstance = (
  type: BaseQueryColumnType,
  {
    id,
    name,
    dbFieldName,
  }: {
    id: string;
    name: string;
    dbFieldName: string;
  }
): IFieldInstance => {
  if (type === BaseQueryColumnType.Aggregation) {
    return createFieldInstanceByRaw({
      id: id,
      dbFieldName,
      name,
      description: AGGREGATION_FIELD_INSTANCE_DESC,
      options: null,
      type: FieldType.Number,
      cellValueType: CellValueType.Number,
      isMultipleCellValue: null,
      dbFieldType: DbFieldType.Integer,
      notNull: null,
      unique: null,
      isPrimary: null,
      isComputed: null,
      isLookup: null,
      isPending: null,
      hasError: null,
      lookupLinkedFieldId: null,
      lookupOptions: null,
      tableId: '',
      order: 0,
      version: 0,
      lastModifiedTime: null,
      deletedTime: null,
      createdBy: '',
      lastModifiedBy: null,
      createdTime: new Date(),
    });
  }
  throw new Error(`Not implemented(createBaseQueryFieldInstance) type: ${type}`);
};
