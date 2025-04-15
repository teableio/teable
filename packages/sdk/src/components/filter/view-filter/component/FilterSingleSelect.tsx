import { ColorUtils } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import type { SingleSelectField } from '../../../../model';
import type { IColorOption } from './base';
import { BaseSingleSelect } from './base';
import { DefaultErrorLabel } from './DefaultErrorLabel';

interface ISingleSelect {
  onSelect: (id: string | null) => void;
  operator: string;
  value: string | null;
  field: SingleSelectField;
  className?: string;
  popoverClassName?: string;
  modal?: boolean;
}

function FilterSingleSelect(props: ISingleSelect) {
  const { onSelect, field, value, className, popoverClassName, modal } = props;

  const options = useMemo<IColorOption[]>(() => {
    return field?.options?.choices.map((choice) => ({
      value: choice.name,
      label: choice.name,
      color: choice.color,
    }));
  }, [field]);

  const optionRender = (option: IColorOption) => {
    const { color, label, value } = option;
    return (
      <div
        key={value}
        className="truncate rounded-lg px-2"
        style={{
          backgroundColor: ColorUtils.getHexForColor(color),
          color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
        }}
      >
        {label}
      </div>
    );
  };

  return (
    <BaseSingleSelect
      options={options}
      value={value}
      onSelect={onSelect}
      className={cn('justify-between', className)}
      popoverClassName={cn(popoverClassName)}
      optionRender={optionRender}
      displayRender={optionRender}
      defaultLabel={<DefaultErrorLabel />}
      placeholderClassName="text-xs"
      modal={modal}
    />
  );
}

export { FilterSingleSelect };
