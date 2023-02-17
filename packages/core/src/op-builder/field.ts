import type { Column, FieldCore, IOtOperation } from '../models';
import { FieldType, StatisticsFunc } from '../models';

enum FieldMetaKey {
  Name = 'name',
  Type = 'type',
  Description = 'description',
  Options = 'options',
  NotNull = 'notNull',
  Unique = 'unique',
  DefaultValue = 'defaultValue',
}

export class FieldOpBuilder {
  private static setViewMeta<T>(params: {
    id: string;
    key: FieldMetaKey;
    oldValue: T;
    newValue: T;
  }): IOtOperation {
    const { id, key, oldValue, newValue } = params;

    return {
      p: ['fieldMap', id, key],
      oi: newValue,
      od: oldValue,
    };
  }

  static addColumn(params: {
    fieldId: string;
    fieldType: FieldType;
    columnIndex: number;
    viewId: string;
    hidden?: boolean;
  }): IOtOperation {
    const { hidden, fieldType, columnIndex, viewId } = params;

    const newColumn: Column = {
      order: columnIndex,
      hidden,
    };

    if ([FieldType.Number, FieldType.Currency].includes(fieldType)) {
      newColumn.statisticFunc = StatisticsFunc.Sum;
    }

    return {
      p: ['viewMap', viewId, 'columns', columnIndex],
      li: newColumn,
    };
  }

  static addField(field: FieldCore): IOtOperation {
    return {
      p: ['fieldMap', field.id],
      oi: field,
    };
  }

  static setFieldName(params: {
    id: string;
    oldValue: string;
    newValue: string | null;
  }): IOtOperation {
    return this.setViewMeta({ ...params, key: FieldMetaKey.Name });
  }

  static setFieldDescription(params: {
    id: string;
    oldValue: string | null;
    newValue: string | null;
  }): IOtOperation {
    return this.setViewMeta({ ...params, key: FieldMetaKey.Description });
  }

  static setFieldOptions(params: {
    id: string;
    oldValue: unknown;
    newValue: unknown;
  }): IOtOperation {
    return this.setViewMeta({ ...params, key: FieldMetaKey.Options });
  }

  static setFieldNotNull(params: {
    id: string;
    oldValue: true | null;
    newValue: true | null;
  }): IOtOperation {
    return this.setViewMeta({ ...params, key: FieldMetaKey.NotNull });
  }

  static setFieldUnique(params: {
    id: string;
    oldValue: true | null;
    newValue: true | null;
  }): IOtOperation {
    return this.setViewMeta({ ...params, key: FieldMetaKey.Unique });
  }

  static setFieldDefaultValue(params: {
    id: string;
    oldValue: unknown;
    newValue: unknown;
  }): IOtOperation {
    return this.setViewMeta({ ...params, key: FieldMetaKey.DefaultValue });
  }
}
