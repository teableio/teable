import type { IFilterOperator } from '@teable/core';
import { getValidFilterOperators } from '@teable/core';
import { useMemo } from 'react';
import { useField } from '../../../hooks';
import { BaseSingleSelect } from '../component';
import { getFieldOperatorMapping, shouldFilterByDefaultValue } from '../utils';

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

export { OperatorSelect };
