import type { ISortItem } from '@teable-group/core';
import { OrderSelect } from './OrderSelect';
import { SortFieldSelect } from './SortFieldSelect';

export interface ISortItemProps {
  index: number;
  value: ISortItem;
  selectedFields?: string[];
  onSelect: (index: number, item: ISortItem) => void;
}

enum ISortKey {
  FIELDID = 'fieldId',
  ASCENDING = 'order',
}

function SortItem(props: ISortItemProps) {
  const { index, value, onSelect, ...restProps } = props;

  const { fieldId, order } = value;

  const selectHandler = (_key: keyof ISortItem, _value: ISortItem[keyof ISortItem]) => {
    onSelect?.(index, { ...value, [_key]: _value });
  };

  return (
    <div className="flex">
      <SortFieldSelect
        value={fieldId}
        onSelect={(value) => selectHandler(ISortKey.FIELDID, value)}
        {...restProps}
      />

      <OrderSelect
        value={order}
        onSelect={(value) => selectHandler(ISortKey.ASCENDING, value)}
        fieldId={fieldId}
      />
    </div>
  );
}

export { SortItem };
