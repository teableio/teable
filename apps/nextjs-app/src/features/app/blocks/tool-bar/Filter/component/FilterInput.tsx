import type { IFilterItem } from '@teable-group/core';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

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
      className={cn('m-1', className)}
    />
  );
};

FilterInput.displayName = 'FilterInput';

export { FilterInput };
