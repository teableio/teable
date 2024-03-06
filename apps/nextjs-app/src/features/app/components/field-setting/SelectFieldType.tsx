import { FieldType } from '@teable/core';
import { FIELD_TYPE_ORDER, useFieldStaticGetter } from '@teable/sdk';
import { Selector } from '@teable/ui-lib/base';
import SearchIcon from '@teable/ui-lib/icons/app/search.svg';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

export const SelectFieldType = (props: {
  value?: FieldType | 'lookup';
  onChange?: (type: FieldType | 'lookup') => void;
}) => {
  const { value = FieldType.SingleLineText, onChange } = props;
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const candidates = useMemo(
    () =>
      FIELD_TYPE_ORDER.map<{ id: FieldType | 'lookup'; name: string; icon: JSX.Element }>(
        (type) => {
          const { title, Icon } = getFieldStatic(type, false);
          return {
            id: type,
            name: title,
            icon: <Icon />,
          };
        }
      ).concat({
        id: 'lookup',
        name: t('sdk:field.title.lookup'),
        icon: <SearchIcon className="size-4" />,
      }),
    [getFieldStatic, t]
  );

  return (
    <Selector
      contentClassName="select-field-type"
      candidates={candidates}
      selectedId={value}
      onChange={(id) => onChange?.(id as FieldType | 'lookup')}
    />
  );
};
