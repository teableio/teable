import type { IFilterOperator } from '@teable-group/core';
import { getValidFilterOperators } from '@teable-group/core';
import { useMemo } from 'react';
import { useField } from '../../../hooks';
import { BaseSingleSelect } from '../component';
import { getFieldOperatorMapping } from '../utils';

interface IOperatorOptions {
  value: IFilterOperator;
  label: string;
}

interface IOperatorSelectProps {
  value?: string;
  fieldId: string;
  onSelect: (value: string | null) => void;
}

function OperatorSelect(props: IOperatorSelectProps) {
  const { onSelect, fieldId } = props;
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
  const value = useMemo(() => {
    const index = operatorOption.findIndex((operator) => operator.value === props.value);
    if (index > -1) {
      return props.value;
    } else {
      onSelect(operatorOption[0]?.value);
      return operatorOption[0]?.value;
    }
  }, [onSelect, operatorOption, props.value]);

  return (
    <BaseSingleSelect
      value={value || null}
      options={operatorOption}
      popoverClassName="w-48"
      className="w-32 justify-between m-1 shrink"
      onSelect={onSelect}
      disabled={shouldDisabled}
    />
  );
}

OperatorSelect.displayName = 'OperatorSelect';

export { OperatorSelect };
