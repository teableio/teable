import type { IFilterMetaOperator } from '@teable-group/core';
import { getValidFilterOperators } from '@teable-group/core';
import { useField } from '@teable-group/sdk';
import { useMemo } from 'react';
import { BaseSingleSelect } from '../component/BaseSingleSelect';

interface IOperator {
  value: IFilterMetaOperator;
  label: string;
}

const commonOperator: IOperator[] = [
  {
    value: 'isNotEmpty',
    label: 'isNotEmpty',
  },
  {
    value: 'isEmpty',
    label: 'isEmpty',
  },
];

const defaultOperator: IOperator[] = [
  {
    value: 'contains',
    label: 'contains',
  },
  {
    value: 'doesNotContain',
    label: 'does not contain',
  },
  {
    value: 'is',
    label: 'is',
  },
  {
    value: 'isNot',
    label: 'is not',
  },
  ...commonOperator,
];

interface IOperatorSelectProps {
  value?: string;
  fieldId: string;
  onSelect: (val: IFilterMetaOperator) => void;
}

function OperatorSelect(props: IOperatorSelectProps) {
  const { onSelect, fieldId } = props;
  const field = useField(fieldId);
  const operators = useMemo<IOperator[]>(() => {
    if (field) {
      return getValidFilterOperators(field).map((operator) => ({
        label: operator,
        value: operator,
      })) as IOperator[];
    }
    return defaultOperator;
  }, [field]);
  const shouldDisabled = useMemo(() => {
    return field?.type === 'checkbox';
  }, [field]);
  const value = useMemo(() => {
    const index = operators.findIndex((operator) => operator.value === props.value);
    if (index > -1) {
      return props.value;
    } else {
      onSelect(operators[0].value);
      return operators[0].value;
    }
  }, [onSelect, operators, props.value]);

  return (
    <BaseSingleSelect
      value={value || null}
      options={operators}
      popoverClassNames="w-[200px]"
      classNames="w-[128px] max-w-[128px] min-w-[128px] justify-between m-1"
      onSelect={onSelect}
      disabled={shouldDisabled}
    />
  );
}

OperatorSelect.displayName = 'OperatorSelect';

export { OperatorSelect };
