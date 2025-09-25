import type { FieldType } from '@teable/core';
import { useFields, useFieldStaticGetter } from '@teable/sdk/hooks';
import { Selector } from '@teable/ui-lib/base';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

interface IFieldSelectProps {
  selectedId?: string;
  excludedIds?: string[];
  excludeTypes?: FieldType[];
  onChange: (fieldId: string) => void;
}

export const FieldSelect: React.FC<IFieldSelectProps> = (props) => {
  const { selectedId, excludeTypes = [], excludedIds = [], onChange } = props;
  const fields = useFields({ withHidden: true, withDenied: true });
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const getFieldStatic = useFieldStaticGetter();

  return (
    <Selector
      className="w-full"
      placeholder={t('table:field.editor.selectField')}
      selectedId={selectedId}
      onChange={onChange}
      candidates={fields
        .filter((f) => !excludeTypes.includes(f.type) && !excludedIds.includes(f.id))
        .map((f) => {
          const Icon = getFieldStatic(f.type, {
            isLookup: f.isLookup,
            hasAiConfig: Boolean(f.aiConfig),
            deniedReadRecord: !f.canReadFieldRecord,
          }).Icon;
          return {
            id: f.id,
            name: f.name,
            icon: <Icon className="size-4 shrink-0" />,
          };
        })}
      searchTip={t('sdk:common.search.placeholder')}
      emptyTip={t('sdk:common.search.empty')}
    />
  );
};
