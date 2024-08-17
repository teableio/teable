import type { IFilterItem } from '@teable/core';
import { Input, cn } from '@teable/ui-lib';
import { toString } from 'lodash';
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

  return (
    <Input
      placeholder={placeholder}
      value={inputValue}
      onChange={(e) => {
        onChange(e.target.value || null);
      }}
      className={cn('h-8 placeholder:text-xs', className)}
    />
  );
};

export { FilterInput };
