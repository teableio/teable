import type { ISortItem } from '@teable/core';
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

  const { fieldId, order } = value;

  const selectHandler = (_key: keyof ISortItem, _value: ISortItem[keyof ISortItem]) => {
    onSelect?.(index, { ...value, [_key]: _value });
  };

  return (
    <div className="flex">
      <FieldSelector
        value={fieldId}
        onSelect={(value) => selectHandler(ISortKey.FieldId, value)}
        excludedIds={selectedFields}
        className="w-40"
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
