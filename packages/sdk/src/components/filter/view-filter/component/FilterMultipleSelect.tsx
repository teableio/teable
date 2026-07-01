import { useTheme } from '@teable/next-themes';
import { useMemo } from 'react';
import type { MultipleSelectField, SingleSelectField } from '../../../../model';
import { getSelectColorPairs } from '../../../../utils/select-color';
import type { IColorOption } from './base';
import { BaseMultipleSelect } from './base';
import { DefaultErrorLabel } from './DefaultErrorLabel';

interface IMultipleSelect {
  onSelect: (value: string[] | null) => void;
  value: string[] | null;
  // SingleSelectField used in MultipleSelect in filter scenario
  field: MultipleSelectField | SingleSelectField;
  className?: string;
  popoverClassName?: string;
  modal?: boolean;
}

const FilterMultipleSelect = (props: IMultipleSelect) => {
  const { field, value, onSelect, className, popoverClassName, modal } = props;
  const { resolvedTheme } = useTheme();
  const values = useMemo(() => {
    if (Array.isArray(value) && value.length) {
      return value;
    }
    return [];
  }, [value]);
  const options = useMemo<IColorOption[]>(() => {
    return field?.options?.choices.map((choice) => ({
      value: choice.name,
      label: choice.name,
      color: choice.color,
    }));
  }, [field]);
  const displayRender = (value: IColorOption) => {
    const { color, backgroundColor } = getSelectColorPairs(value.color, resolvedTheme);
    return (
      <div
        key={value?.value}
        className="flex h-5 max-w-full shrink-0 items-center rounded-full px-2 text-xs font-normal"
        style={{
          backgroundColor,
          color,
        }}
        title={value.label}
      >
        <span className="truncate">{value.label}</span>
      </div>
    );
  };
  const optionRender = (value: IColorOption) => {
    const { color, backgroundColor } = getSelectColorPairs(value.color, resolvedTheme);
    return (
      <div
        key={value?.value}
        className="flex h-5 max-w-full items-center overflow-hidden rounded-full px-2 text-xs font-normal"
        style={{
          backgroundColor,
          color,
        }}
        title={value.label}
      >
        <span className="truncate">{value.label}</span>
      </div>
    );
  };

  return (
    <BaseMultipleSelect
      options={options}
      onSelect={onSelect}
      value={values}
      displayRender={displayRender}
      optionRender={optionRender}
      className={className}
      popoverClassName={popoverClassName}
      defaultLabel={<DefaultErrorLabel />}
      modal={modal}
    />
  );
};

export { FilterMultipleSelect };
