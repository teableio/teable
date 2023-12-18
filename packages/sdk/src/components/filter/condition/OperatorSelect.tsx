import type { IFilterOperator } from '@teable-group/core';
import { getValidFilterOperators } from '@teable-group/core';
import { useEffect, useMemo } from 'react';
import { useField } from '../../../hooks';
import { BaseSingleSelect } from '../component';
import { getFieldOperatorMapping } from '../utils';

interface IOperatorOptions {
  value: IFilterOperator;
  label: string;
}

interface IOperatorSelectProps {
  value: string | null;
  fieldId: string;
  onSelect: (value: string | null) => void;
}

function OperatorSelect(props: IOperatorSelectProps) {
  const { onSelect, fieldId, value } = props;
  const field = useField(fieldId);
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
  const shouldDisabled = useMemo(() => {
    return field?.type === 'checkbox';
  }, [field]);
  useEffect(() => {
    const index = operatorOption.findIndex((operator) => operator.value === value);
    if (index === -1) {
      onSelect?.(operatorOption?.[0]?.value);
    }
  }, [onSelect, operatorOption, value]);

  return (
    <BaseSingleSelect
      value={value}
      options={operatorOption}
      popoverClassName="w-48"
      className="m-1 w-32 shrink justify-between"
      onSelect={onSelect}
      disabled={shouldDisabled}
    />
  );
}

export { OperatorSelect };
