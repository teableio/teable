import type { IFilterOperator, IFilterItem } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useCallback, useMemo } from 'react';
import { useCrud } from '../../hooks';
import type { IBaseFilterCustomComponentProps, IConditionItemProperty } from '../../types';
import { DefaultErrorLabel } from '../component';
import { BaseSingleSelect } from '../component/base/BaseSingleSelect';
import { useOperators } from '../hooks';
import { useFields } from '../hooks/useFields';
import { useOperatorI18nMap } from '../hooks/useOperatorI18nMap';
import type { IViewFilterConditionItem } from '../types';
import { shouldFilterByDefaultValue, shouldResetFieldValue } from '../utils';

interface IOperatorOptions {
  value: IFilterOperator;
  label: string;
}

interface IBaseOperatorSelectProps<T extends IConditionItemProperty = IViewFilterConditionItem>
  extends IBaseFilterCustomComponentProps<T, IFilterItem['operator']> {
  disabledOperators?: IFilterOperator[];
}

export const OperatorSelect = <T extends IConditionItemProperty = IViewFilterConditionItem>(
  props: IBaseOperatorSelectProps<T>
) => {
  const { value, item, path, disabledOperators } = props;
  const { field: fieldId } = item;
  const { onChange } = useCrud();
  const fields = useFields();
  const field = fields.find((f) => f.id === fieldId);
  const labelMapping = useOperatorI18nMap(field?.cellValueType);
  const operators = useOperators(field);
  const operatorOption = useMemo<IOperatorOptions[]>(() => {
    return operators
      .filter((operator) => !disabledOperators?.includes(operator))
      .map((operator) => {
        return {
          label: labelMapping[operator],
          value: operator,
        };
      });
  }, [labelMapping, operators, disabledOperators]);

  const shouldDisabled = useMemo(() => shouldFilterByDefaultValue(field), [field]);

  const onSelectHandler = useCallback(
    (value: IFilterItem['operator'] | null) => {
      const resetFieldValue = shouldResetFieldValue(item.operator as string, value as string);
      if (resetFieldValue || !operators.includes(value as IFilterOperator)) {
        const newPath = path.slice(0, -1);
        onChange(newPath, {
          field: item.field,
          operator: value,
          value: null,
        });
      } else {
        onChange(path, value);
      }
    },
    [item.field, item.operator, onChange, operators, path]
  );

  return (
    <BaseSingleSelect
      value={value}
      options={operatorOption}
      popoverClassName="w-48"
      className={cn('shrink-0 justify-between w-28')}
      onSelect={onSelectHandler}
      disabled={shouldDisabled}
      defaultLabel={<DefaultErrorLabel />}
    />
  );
};
