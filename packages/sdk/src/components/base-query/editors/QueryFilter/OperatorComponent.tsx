import type { FieldCore } from '@teable/core';
import { CellValueType, FieldType, getValidFilterOperators } from '@teable/core';
import { BaseQueryColumnType } from '@teable/openapi';
import { useMemo } from 'react';
import { useOperatorI18nMap, type IFilterBaseComponent } from '../../../filter';
import { useCrud } from '../../../filter/hooks';
import { BaseSingleSelect, DefaultErrorLabel } from '../../../filter/view-filter/component';
import {
  shouldFilterByDefaultValue,
  shouldResetFieldValue,
} from '../../../filter/view-filter/utils';
import { useAllColumns } from '../../common/useAllColumns';
import type { IBaseFilterItem } from './types';

export const OperatorComponent: IFilterBaseComponent<IBaseFilterItem> = (props) => {
  const { path, value, item } = props;
  const { onChange } = useCrud();
  const columns = useAllColumns();

  const field = columns.find((column) => column.column === item.field)?.fieldSource;
  const { type, cellValueType } = useMemo(() => {
    if (item.type === BaseQueryColumnType.Field) {
      return {
        type: field?.type,
        cellValueType: field?.cellValueType,
      };
    }
    if (item.type === BaseQueryColumnType.Aggregation) {
      return {
        type: FieldType.Number,
        cellValueType: CellValueType.Number,
      };
    }
    return {};
  }, [field?.cellValueType, field?.type, item.type]);

  const operators = useMemo(() => {
    if (item.type === BaseQueryColumnType.Field) {
      return field ? getValidFilterOperators(field) : [];
    }
    if (item.type === BaseQueryColumnType.Aggregation) {
      return getValidFilterOperators({
        cellValueType: CellValueType.Number,
        type: FieldType.Number,
      } as FieldCore);
    }
    return [];
  }, [field, item.type]);

  const operatorsStatic = useOperatorI18nMap(cellValueType);
  const shouldDisabled = useMemo(
    () => shouldFilterByDefaultValue(type && cellValueType ? { type, cellValueType } : undefined),
    [cellValueType, type]
  );

  const operatorOption = useMemo(() => {
    return operators.map((operator) => {
      return {
        label: operatorsStatic[operator],
        value: operator,
      };
    });
  }, [operatorsStatic, operators]);

  const onSelectHandler = (value: IBaseFilterItem['operator'] | null) => {
    const resetFieldValue = shouldResetFieldValue(item.operator as string, value as string);
    if (resetFieldValue || !operators.includes(value as IBaseFilterItem['operator'])) {
      const newPath = path.slice(0, -1);
      onChange(newPath, {
        ...item,
        operator: value,
        value: null,
      });
    } else {
      onChange(path, value);
    }
  };

  return (
    <BaseSingleSelect
      value={value}
      options={operatorOption}
      popoverClassName="w-48"
      className="h-7 w-28 shrink-0 justify-between"
      onSelect={onSelectHandler}
      disabled={shouldDisabled}
      defaultLabel={<DefaultErrorLabel />}
    />
  );
};
