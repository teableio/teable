import type { Colors } from '@teable-group/core';
import { ColorUtils } from '@teable-group/core';
import type { SingleSelectField } from '@teable-group/sdk';

import { useMemo } from 'react';

import { BaseSingleSelect } from './base/BaseSingleSelect';

interface ISingleSelect {
  onSelect: (id: string | null) => void;
  operator: string;
  value: string | null;
  field: SingleSelectField;
}

interface IColorOption {
  value: string;
  label: string;
  color: Colors;
}

function SingleSelect(props: ISingleSelect) {
  const { onSelect, field, value } = props;

  const options = useMemo<IColorOption[]>(() => {
    return field?.options?.choices.map((choice) => ({
      value: choice.name,
      label: choice.name,
      color: choice.color,
    }));
  }, [field]);

  // useEffect(() => {
  //   // other type value comes, adapter or reset
  //   const isNull = value === null;
  //   const isSameType = typeof value === 'string';
  //   const isInOption = options.findIndex((option) => option.value === value) > -1;
  //   if ((!isNull && !isSameType) || !isInOption) {
  //     onSelect?.(null);
  //   }
  // }, [onSelect, value, operator, options]);

  const optionRender = (option: IColorOption) => {
    const { color, label, value } = option;
    return (
      <>
        <div
          key={value}
          className="px-2 rounded-lg truncate"
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
      className="w-64 justify-between m-1"
      popoverClassName="w-64"
      optionRender={optionRender}
      displayRender={optionRender}
    />
  );
}

SingleSelect.displayName = 'SingleSelect';

export { SingleSelect };
