import { FieldType, PRIMARY_SUPPORTED_TYPES } from '@teable/core';
import { FIELD_TYPE_ORDER, useFieldStaticGetter } from '@teable/sdk';
import SearchIcon from '@teable/ui-lib/icons/app/search.svg';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { Selector } from '@/components/Selector';
import { tableConfig } from '@/features/i18n/table.config';

export const SelectFieldType = (props: {
  isPrimary?: boolean;
  value?: FieldType | 'lookup';
  onChange?: (type: FieldType | 'lookup') => void;
}) => {
  const { isPrimary, value = FieldType.SingleLineText, onChange } = props;
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const candidates = useMemo(() => {
    const fieldTypes = isPrimary
      ? FIELD_TYPE_ORDER.filter((type) => PRIMARY_SUPPORTED_TYPES.has(type))
      : FIELD_TYPE_ORDER;
    const result = fieldTypes.map<{ id: FieldType | 'lookup'; name: string; icon: JSX.Element }>(
      (type) => {
        const { title, Icon } = getFieldStatic(type, false, false);
        return {
          id: type,
          name: title,
          icon: <Icon />,
        };
      }
    );

    return isPrimary
      ? result
      : result.concat({
          id: 'lookup',
          name: t('sdk:field.title.lookup'),
          icon: <SearchIcon className="size-4" />,
        });
  }, [getFieldStatic, t, isPrimary]);

  return (
    <Selector
      contentClassName="select-field-type"
      candidates={candidates}
      selectedId={value}
      onChange={(id) => onChange?.(id as FieldType | 'lookup')}
    />
  );
};
