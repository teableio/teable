import { useTheme } from '@teable/next-themes';
import { cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import type { SingleSelectField } from '../../../../model';
import { getSelectColorPairs } from '../../../../utils/select-color';
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
  const { resolvedTheme } = useTheme();

  const options = useMemo<IColorOption[]>(() => {
    return (field?.options?.choices ?? []).map((choice) => ({
      value: choice.name,
      label: choice.name,
      color: choice.color,
    }));
  }, [field]);

  const optionRender = (option: IColorOption) => {
    const { color, label, value } = option;
    const colorPair = getSelectColorPairs(color, resolvedTheme);
    return (
      <div
        key={value}
        className="flex h-5 max-w-full items-center overflow-hidden rounded-full px-2 text-xs"
        style={{
          backgroundColor: colorPair.backgroundColor,
          color: colorPair.color,
        }}
        title={label}
      >
        <span className="truncate">{label}</span>
      </div>
    );
  };

  return (
    <BaseSingleSelect
      options={options}
      value={value}
      onSelect={onSelect}
      className={cn('justify-between px-2 py-0', className)}
      popoverClassName={cn(popoverClassName)}
      optionRender={optionRender}
      displayRender={optionRender}
      defaultLabel={<DefaultErrorLabel />}
      placeholderClassName="text-sm"
      modal={modal}
    />
  );
}

export { FilterSingleSelect };
