import type { IFilterItem } from '@teable/core';
import { Input } from '@teable/ui-lib';
import classNames from 'classnames';
import { debounce } from 'lodash';
import { useEffect, useMemo, useState } from 'react';

interface InputProps {
  value: IFilterItem['value'];
  onChange: (value: string | null) => void;
  placeholder: string;
  className?: string;
}

const FilterInput = (props: InputProps) => {
  const { onChange, placeholder = 'Enter a value', value, className } = props;
  const [input, setInput] = useState<string>((value as string) ?? '');

  useEffect(() => {
    if (!['string', 'number'].includes(typeof value)) {
      onChange(null);
    }
  }, [onChange, value]);

  const updateInput = useMemo(() => {
    return debounce(setInput, 30);
  }, []);

  useEffect(() => {
    updateInput((value as string) ?? '');
  }, [updateInput, value]);

  return (
    <Input
      placeholder={placeholder}
      value={input}
      onChange={(e) => {
        setInput(e.target.value);
      }}
      onBlur={() => onChange(input ?? null)}
      className={classNames('m-1 h-8 placeholder:text-[13px]', className)}
    />
  );
};

export { FilterInput };
