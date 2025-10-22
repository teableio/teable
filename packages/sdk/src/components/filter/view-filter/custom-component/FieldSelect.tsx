import { getValidFilterOperators, isFieldReferenceValue } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useCallback, useMemo } from 'react';
import { useFieldStaticGetter, useTables } from '../../../../hooks';
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
  const { path, value, modal = true, item } = props;
  const { onChange } = useCrud();
  const options = useMemo(() => {
    return fields.map((field) => ({
      value: field.id,
      label: field.name,
      ...field,
    }));
  }, [fields]);
  const fieldStaticGetter = useFieldStaticGetter();
  const tables = useTables();

  const fieldReferenceValue = useMemo(() => {
    const candidate = item?.value;
    return isFieldReferenceValue(candidate) ? candidate : undefined;
  }, [item?.value]);

  const headingTableId = fieldReferenceValue?.tableId ?? fields[0]?.tableId;

  const groupHeading = useMemo(() => {
    if (!fieldReferenceValue) {
      return undefined;
    }
    if (headingTableId) {
      const tableName = tables?.find((table) => table.id === headingTableId)?.name;
      if (tableName) {
        return tableName;
      }
    }
    return undefined;
  }, [fieldReferenceValue, headingTableId, tables]);
  const optionRender = useCallback(
    (option: (typeof options)[number]) => {
      const { Icon } = fieldStaticGetter(option.type, {
        isLookup: option.isLookup,
        isConditionalLookup: option.isConditionalLookup,
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
        const currentValue = item?.value;
        const nextValue = isFieldReferenceValue(currentValue) ? currentValue : null;
        // change the field, meanwhile, reset the operator and value (keep field reference)
        onChange(newPath, {
          field: value,
          operator: operators[0] || null,
          value: nextValue,
        });
      }}
      value={value}
      className={cn('shrink-0 w-32 h-8')}
      popoverClassName="w-fit"
      optionRender={optionRender}
      defaultLabel={<DefaultErrorLabel />}
      displayRender={(selectedField) => {
        const { type, isLookup, label, aiConfig, recordRead } = selectedField;
        const { Icon } = fieldStaticGetter(type, {
          isLookup,
          isConditionalLookup: selectedField.isConditionalLookup,
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
      groupHeading={groupHeading}
    />
  );
};
