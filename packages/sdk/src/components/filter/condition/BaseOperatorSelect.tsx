import type { IFilterOperator } from '@teable/core';
import { getValidFilterOperators } from '@teable/core';
import { useMemo } from 'react';
import type { IFieldInstance } from '../../../model';
import { BaseSingleSelect } from '../component';
import { getFieldOperatorMapping, shouldFilterByDefaultValue } from '../utils';

interface IOperatorOptions {
  value: IFilterOperator;
  label: string;
}

interface IBaseOperatorSelectProps {
  value: string | null;
  onSelect: (value: string | null) => void;
  field?: IFieldInstance;
}

export function BaseOperatorSelect(props: IBaseOperatorSelectProps) {
  const { onSelect, value, field } = props;
  const labelMapping = useMemo(() => getFieldOperatorMapping(field?.type), [field]);
  const operatorOption = useMemo<IOperatorOptions[]>(() => {
    if (field) {
      return getValidFilterOperators(field).map((operator) => ({
        label: labelMapping[operator],
        value: operator,
      }));
    }
    return [] as IOperatorOptions[];
  }, [field, labelMapping]);

  const shouldDisabled = useMemo(() => shouldFilterByDefaultValue(field), [field]);

  return (
    <BaseSingleSelect
      value={value}
      options={operatorOption}
      popoverClassName="w-48"
      className="m-1 w-32 shrink-0 justify-between"
      onSelect={onSelect}
      disabled={shouldDisabled}
    />
  );
}
