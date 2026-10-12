import type { IFilterOperator, IFilterItem } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import { useInDrawer } from '../../../adaptive-panel';
import { useCrud } from '../../hooks';
import type { IBaseFilterCustomComponentProps, IConditionItemProperty } from '../../types';
import { DefaultErrorLabel } from '../component';
import { BaseSingleSelect } from '../component/base/BaseSingleSelect';
import { useOperators } from '../hooks';
import { useFields } from '../hooks/useFields';
import { useFilterModal } from '../hooks/useFilterModal';
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
  const { t } = useTranslation();
  const inDrawer = useInDrawer();
  const ctxModal = useFilterModal();
  const { value, item, path, disabledOperators, modal = ctxModal } = props;
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
      const resetFieldValue = shouldResetFieldValue(
        item.operator as string,
        value as string,
        field
      );
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
    [field, item.field, item.operator, onChange, operators, path]
  );

  return (
    <BaseSingleSelect
      value={value}
      options={operatorOption}
      popoverClassName="w-48"
      drawerTitle={t('filter.selectOperator')}
      className={cn('h-8 w-20 shrink-0 justify-between gap-0 pe-1.5', inDrawer && 'w-[120px]')}
      onSelect={onSelectHandler}
      disabled={shouldDisabled}
      defaultLabel={<DefaultErrorLabel />}
      modal={modal}
    />
  );
};
