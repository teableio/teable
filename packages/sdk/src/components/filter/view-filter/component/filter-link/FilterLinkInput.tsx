import { cn } from '@teable/ui-lib';
import { useTranslation } from '../../../../../context/app/i18n';
import { FilterInput } from '../FilterInput';
import type { IFilterLinkProps } from './types';

type IFilterLinkInputProps = IFilterLinkProps<string>;

export const FilterLinkInput = (props: IFilterLinkInputProps) => {
  const { value, onSelect, className } = props;
  const { t } = useTranslation();

  return (
    <FilterInput
      placeholder={t('filter.linkInputPlaceholder')}
      value={value}
      onChange={onSelect}
      className={cn('w-40', className)}
    />
  );
};
