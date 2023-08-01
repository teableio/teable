import { Input } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useEffect } from 'react';

interface InputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder: string;
  className?: string;
}

const FilterInputNumber = (props: InputProps) => {
  const { onChange, placeholder = 'Enter a value', value, className } = props;

  useEffect(() => {
    if (!['string', 'number'].includes(typeof value)) {
      onChange(null);
    }
  }, [onChange, value]);

  return (
    <Input
      placeholder={placeholder}
      value={(value as number) ?? ''}
      onInput={(e) => {
        // limit the number positive
        e.currentTarget.value = e.currentTarget.value?.replace(/\D/g, '');
      }}
      onChange={(e) => {
        const value = e.target.value === '' ? null : Number(e.target.value) ?? null;
        onChange(value);
      }}
      className={classNames('m-1 h-8 placeholder:text-[13px]', className)}
    />
  );
};

export { FilterInputNumber };
