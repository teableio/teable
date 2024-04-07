import type { FieldType } from '@teable/core';
import type { IFilterComponents } from '@teable/sdk/components';
import { SelectTag } from '@teable/sdk/components/editor/select/SelectTag';
import { useTranslation } from 'next-i18next';
import { shareConfig } from '@/features/i18n/share.config';
import { StorageSelected } from './FilterLinkSelectList';

export const FilterLinkSelectTrigger: IFilterComponents[FieldType.Link] = (props) => {
  const { value } = props;
  const { t } = useTranslation(shareConfig.i18nNamespaces);

  if (!value) {
    return <>{t('share:toolbar.filterLinkSelectPlaceholder')}</>;
  }

  const values = typeof value === 'string' ? [value] : value;

  return (
    <>
      {values?.map((id) => (
        <SelectTag
          className="flex items-center"
          key={id}
          label={StorageSelected[id] || t('sdk:common.unnamedRecord')}
        />
      ))}
    </>
  );
};
