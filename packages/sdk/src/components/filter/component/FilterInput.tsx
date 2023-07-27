import type { IFilterItem } from '@teable-group/core';
import { Input } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useEffect } from 'react';

interface InputProps {
  value: IFilterItem['value'];
  onChange: (value: string | null) => void;
  placeholder: string;
  className?: string;
}

const FilterInput = (props: InputProps) => {
  const { onChange, placeholder = 'Enter a value', value, className } = props;

  useEffect(() => {
    if (!['string', 'number'].includes(typeof value)) {
      onChange(null);
    }
  }, [onChange, value]);

  return (
    <Input
      placeholder={placeholder}
      value={(value as string) ?? ''}
      onChange={(e) => {
        onChange(e.target.value ?? null);
      }}
      className={classNames('m-1 h-8 placeholder:text-[13px]', className)}
    />
  );
};

FilterInput.displayName = 'FilterInput';

export { FilterInput };
