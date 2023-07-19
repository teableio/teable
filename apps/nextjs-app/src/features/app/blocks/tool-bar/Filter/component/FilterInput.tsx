import type { IFilterMeta } from '@teable-group/core';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { useEffect } from 'react';

interface InputProps {
  value: IFilterMeta['value'];
  onChange: (value: string | null) => void;
  placeholder: string;
}

const FilterInput = (props: InputProps) => {
  const { onChange, placeholder = 'Enter a value', value } = props;

  useEffect(() => {
    if (typeof value !== 'string') {
      onChange(null);
    }
  }, [onChange, value]);

  return (
    <Input
      placeholder={placeholder}
      value={(value as string) || ''}
      onChange={(e) => {
        onChange(e.target.value || null);
      }}
      className="m-1"
    />
  );
};

FilterInput.displayName = 'FilterInput';

export { FilterInput };
