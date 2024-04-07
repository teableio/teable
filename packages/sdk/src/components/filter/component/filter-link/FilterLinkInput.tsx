import { useTranslation } from '../../../../context/app/i18n';
import { FilterInput } from '../FilterInput';
import type { IFilterLinkProps } from './types';

type IFilterLinkInputProps = IFilterLinkProps<string>;

export const FilterLinkInput = (props: IFilterLinkInputProps) => {
  const { value, onSelect } = props;
  const { t } = useTranslation();

  return (
    <FilterInput
      placeholder={t('filter.linkInputPlaceholder')}
      value={value}
      onChange={onSelect}
      className="w-40"
    />
  );
};
