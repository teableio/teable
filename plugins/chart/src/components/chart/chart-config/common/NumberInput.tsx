import { cn, Input } from '@teable/ui-lib';
import { useState } from 'react';

export interface INumberInputProps {
  className?: string;
  value?: number;
  onValueChange?: (value: number | undefined) => void;
  decimal?: number;
  min?: number;
  max?: number;
}

export const NumberInput = (props: INumberInputProps) => {
  const { className, decimal, min, max, onValueChange } = props;
  const [value, setValue] = useState(props.value);

  return (
    <Input
      type="number"
      className={cn('h-7 text-[13px]', className)}
      value={value ?? ''}
      onBlur={() => value !== props.value && onValueChange?.(value)}
      onChange={(e) => {
        if (decimal) {
          const number = parseFloat(parseFloat(e.target.value).toFixed(decimal));
          setValue(
            isNaN(number)
              ? undefined
              : min && number < min
                ? min
                : max && number > max
                  ? max
                  : number
          );
          return;
        }
        const number = parseInt(e.target.value);
        setValue(isNaN(number) ? undefined : number);
      }}
    />
  );
};
