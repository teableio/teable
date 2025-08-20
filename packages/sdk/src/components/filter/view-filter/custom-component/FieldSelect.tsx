import { getValidFilterOperators } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useCallback, useMemo } from 'react';
import { useFieldStaticGetter } from '../../../../hooks';
import { useCrud } from '../../hooks';
import type { IBaseFilterCustomComponentProps, IConditionItemProperty } from '../../types';
import { DefaultErrorLabel } from '../component';
import { BaseSingleSelect } from '../component/base/BaseSingleSelect';
import { useFields } from '../hooks/useFields';
import type { IViewFilterConditionItem } from '../types';

interface IFieldSelectProps<T extends IConditionItemProperty = IViewFilterConditionItem>
  extends IBaseFilterCustomComponentProps<T, string | null> {}

export const FieldSelect = <T extends IConditionItemProperty = IViewFilterConditionItem>(
  props: IFieldSelectProps<T>
) => {
  const fields = useFields();
  const { path, value, modal = true } = props;
  const { onChange } = useCrud();
  const options = useMemo(() => {
    return fields.map((field) => ({
      value: field.id,
      label: field.name,
      ...field,
    }));
  }, [fields]);
  const fieldStaticGetter = useFieldStaticGetter();
  const optionRender = useCallback(
    (option: (typeof options)[number]) => {
      const { Icon } = fieldStaticGetter(option.type, {
        isLookup: option.isLookup,
        hasAiConfig: Boolean(option.aiConfig),
      });
      return (
        <>
          <Icon className="size-4 shrink-0" />
          <div className="truncate pl-1 text-[13px]">{option.label}</div>
        </>
      );
    },
    [fieldStaticGetter]
  );

  return (
    <BaseSingleSelect
      options={options}
      modal={modal}
      onSelect={(value) => {
        const newPath = path.slice(0, -1);
        const field = fields.find((f) => f.id === value);
        // if field is not found, do nothing
        if (!field) {
          return;
        }
        const operators = getValidFilterOperators(field);
        // change the field, meanwhile, reset the operator and value
        onChange(newPath, {
          field: value,
          operator: operators[0] || null,
          value: null,
        });
      }}
      value={value}
      className={cn('shrink-0 w-32')}
      popoverClassName="w-fit"
      optionRender={optionRender}
      defaultLabel={<DefaultErrorLabel />}
      displayRender={(selectedField) => {
        const { type, isLookup, label, aiConfig, recordRead } = selectedField;
        const { Icon } = fieldStaticGetter(type, {
          isLookup,
          hasAiConfig: Boolean(aiConfig),
          deniedReadRecord: recordRead === false,
        });
        return (
          <div className="flex flex-1 items-center truncate">
            <Icon className="shrink-0" />
            <span className="truncate pl-1">{label}</span>
          </div>
        );
      }}
    />
  );
};
