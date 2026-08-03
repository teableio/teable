import {
  CellValueType,
  DbFieldType,
  FieldType,
  getRandomString,
  NumberFieldCore,
} from '@teable/core';
import { BaseQueryColumnType } from '@teable/openapi';
import type { IFieldInstance } from '../../../field/model/factory';
import { createFieldInstanceByVo } from '../../../field/model/factory';

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
    return createFieldInstanceByVo({
      id: id,
      dbFieldName,
      name,
      description: AGGREGATION_FIELD_INSTANCE_DESC,
      options: NumberFieldCore.defaultOptions(),
      type: FieldType.Number,
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Real,
    });
  }
  throw new Error(`Not implemented(createBaseQueryFieldInstance) type: ${type}`);
};
