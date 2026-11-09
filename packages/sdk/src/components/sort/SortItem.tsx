import type { ISortItem } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useTranslation } from '../../context/app/i18n';
import type { IFieldInstance } from '../../model';
import { supportsPinyinSort } from '../../utils/sort';
import { useInDrawer } from '../adaptive-panel';
import { FieldSelector } from '../field/FieldSelector';
import { OrderSelect } from './OrderSelect';

export interface ISortItemProps {
  fields: IFieldInstance[];
  index: number;
  value: ISortItem;
  selectedFields?: string[];
  enablePinyin?: boolean;
  onSelect: (index: number, item: ISortItem) => void;
}

function SortItem(props: Readonly<ISortItemProps>) {
  const {
    fields,
    index,
    value,
    onSelect,
    selectedFields,
    enablePinyin = false,
    ...restProps
  } = props;
  const { t } = useTranslation();
  const inDrawer = useInDrawer();

  const { fieldId, order, collation } = value;

  const selectField = (nextFieldId: string) => {
    const { collation: currentCollation, ...rest } = value;
    const field = fields.find((field) => field.id === nextFieldId);
    onSelect(index, {
      ...rest,
      fieldId: nextFieldId,
      ...(enablePinyin && currentCollation && supportsPinyinSort(field)
        ? { collation: currentCollation }
        : {}),
    });
  };

  const selectOrder = (nextOrder: ISortItem['order'], nextCollation?: 'zh-pinyin') => {
    const { collation: _collation, ...rest } = value;
    onSelect(index, {
      ...rest,
      order: nextOrder,
      ...(nextCollation ? { collation: nextCollation } : {}),
    });
  };

  return (
    <div className={cn('flex', inDrawer && 'min-w-0 flex-1 items-center gap-2')}>
      <FieldSelector
        value={fieldId}
        onSelect={selectField}
        fields={fields}
        excludedIds={selectedFields}
        className={cn('h-8 w-40', inDrawer && 'h-9 w-auto min-w-0 flex-[2]')}
        drawerTitle={t('common.selectField')}
        {...restProps}
      />

      <OrderSelect
        value={order}
        onSelect={selectOrder}
        collation={collation}
        enablePinyin={enablePinyin}
        fieldId={fieldId}
      />
    </div>
  );
}

export { SortItem };
