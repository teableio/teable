import type { IFilterOperator } from '@teable/core';
import { getValidFilterOperators } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import type { IFieldInstance } from '../../../model';
import { BaseSingleSelect } from '../component';
import { useCompact, useOperatorI18nMap } from '../hooks';
import { shouldFilterByDefaultValue } from '../utils';

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
  const compact = useCompact();
  const labelMapping = useOperatorI18nMap(field!);

  const operatorOption = useMemo<IOperatorOptions[]>(() => {
    if (field) {
      return getValidFilterOperators(field).map((operator) => {
        return {
          label: labelMapping[operator],
          value: operator,
        };
      });
    }
    return [] as IOperatorOptions[];
  }, [field, labelMapping]);

  const shouldDisabled = useMemo(() => shouldFilterByDefaultValue(field), [field]);

  return (
    <BaseSingleSelect
      value={value}
      options={operatorOption}
      popoverClassName="w-48"
      className={cn('m-1 shrink-0 justify-between', {
        'max-w-32': compact,
        'w-32': !compact,
      })}
      onSelect={onSelect}
      disabled={shouldDisabled}
    />
  );
}
