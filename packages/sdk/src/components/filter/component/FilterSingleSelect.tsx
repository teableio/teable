import { ColorUtils } from '@teable/core';
import { useMemo } from 'react';
import type { SingleSelectField } from '../../../model';
import type { IColorOption } from './base';
import { BaseSingleSelect } from './base';

interface ISingleSelect {
  onSelect: (id: string | null) => void;
  operator: string;
  value: string | null;
  field: SingleSelectField;
}

function FilterSingleSelect(props: ISingleSelect) {
  const { onSelect, field, value } = props;

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
      <>
        <div
          key={value}
          className="truncate rounded-lg px-2"
          style={{
            backgroundColor: ColorUtils.getHexForColor(color),
            color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
          }}
        >
          {label ?? 'Untitled'}
        </div>
      </>
    );
  };

  return (
    <BaseSingleSelect
      options={options}
      value={value}
      onSelect={onSelect}
      className="w-64 justify-between"
      popoverClassName="w-64"
      optionRender={optionRender}
      displayRender={optionRender}
    />
  );
}

export { FilterSingleSelect };
