import type { IFilterItem } from '@teable/core';
import { Input, cn } from '@teable/ui-lib';
import { toString } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../../../context/app/i18n';

interface InputProps {
  value: IFilterItem['value'];
  onChange: (value: string | null) => void;
  placeholder: string;
  className?: string;
}

const FilterInput = (props: InputProps) => {
  const { t } = useTranslation();
  const { onChange, placeholder = t('filter.default.placeholder'), value, className } = props;
  const inputValue = toString(value);
  const [compositing, setCompositing] = useState(false);
  const [stashValue, setStashValue] = useState(inputValue);
  const [isFocus, setIsFocus] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current && !isFocus) {
      inputRef.current.value = inputValue;
    }
  }, [inputValue, isFocus]);

  return (
    <Input
      placeholder={placeholder}
      defaultValue={inputValue}
      ref={inputRef}
      onInput={(e) => {
        setStashValue(e.currentTarget.value);
        !compositing && onChange(e.currentTarget.value || null);
      }}
      onCompositionStart={() => setCompositing(true)}
      onCompositionEnd={() => {
        setCompositing(false);
        onChange(stashValue || null);
      }}
      onBlur={() => {
        setIsFocus(false);
      }}
      onFocus={() => {
        if (!isFocus) {
          setIsFocus(true);
        }
      }}
      className={cn('h-8 placeholder:text-xs', className)}
    />
  );
};

export { FilterInput };
