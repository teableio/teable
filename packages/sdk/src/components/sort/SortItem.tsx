import { FieldType, type ISortItem } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useTranslation } from '../../context/app/i18n';
import { useFields } from '../../hooks';
import { useInDrawer } from '../adaptive-panel';
import { FieldSelector } from '../field/FieldSelector';
import { OrderSelect } from './OrderSelect';

export interface ISortItemProps {
  index: number;
  value: ISortItem;
  selectedFields?: string[];
  onSelect: (index: number, item: ISortItem) => void;
}

enum ISortKey {
  FieldId = 'fieldId',
  Ascending = 'order',
}

function SortItem(props: ISortItemProps) {
  const { index, value, onSelect, selectedFields, ...restProps } = props;
  const { t } = useTranslation();
  const inDrawer = useInDrawer();

  const { fieldId, order } = value;

  const selectHandler = (_key: keyof ISortItem, _value: ISortItem[keyof ISortItem]) => {
    onSelect?.(index, { ...value, [_key]: _value });
  };

  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = defaultFields.filter((f) => f.type !== FieldType.Button);

  return (
    <div className={cn('flex', inDrawer && 'min-w-0 flex-1 items-center gap-2')}>
      <FieldSelector
        value={fieldId}
        onSelect={(value) => selectHandler(ISortKey.FieldId, value)}
        fields={fields}
        excludedIds={selectedFields}
        className={cn('h-8 w-40', inDrawer && 'h-9 w-auto min-w-0 flex-[2]')}
        drawerTitle={t('common.selectField')}
        {...restProps}
      />

      <OrderSelect
        value={order}
        onSelect={(value) => selectHandler(ISortKey.Ascending, value)}
        fieldId={fieldId}
      />
    </div>
  );
}

export { SortItem };
