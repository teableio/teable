import type { IFilterMetaOperator } from '@teable-group/core';
import { getValidFilterOperators } from '@teable-group/core';
import { useField, operatorLabelMapping } from '@teable-group/sdk';

import { useMemo } from 'react';
import { BaseSingleSelect } from '../component';

interface IOperatorOptions {
  value: IFilterMetaOperator;
  label: string;
}

interface IOperatorSelectProps {
  value?: string;
  fieldId: string;
  onSelect: (value: string) => void;
}

function OperatorSelect(props: IOperatorSelectProps) {
  const { onSelect, fieldId } = props;
  const field = useField(fieldId);
  const operatorOption = useMemo<IOperatorOptions[]>(() => {
    if (field) {
      return getValidFilterOperators(field).map((operator) => ({
        label: operatorLabelMapping[operator],
        value: operator,
      }));
    }
    return [] as IOperatorOptions[];
  }, [field]);
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
      popoverClassName="w-[200px]"
      className="w-[128px] max-w-[128px] min-w-[128px] justify-between m-1"
      onSelect={onSelect}
      disabled={shouldDisabled}
    />
  );
}

OperatorSelect.displayName = 'OperatorSelect';

export { OperatorSelect };
