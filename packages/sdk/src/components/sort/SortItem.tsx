import type { ISortItem } from '@teable-group/core';
import { OrderSelect } from './OrderSelect';
import { SortFieldSelect } from './SortFieldSelect';

interface ISortItemProps {
  index: number;
  value: ISortItem;
  selectedFields?: string[];
  onSelect: (index: number, item: ISortItem) => void;
}

enum ISortKey {
  COLUMN = 'column',
  ASCENDING = 'order',
}

function SortItem(props: ISortItemProps) {
  const { index, value, onSelect, ...restProps } = props;

  const { column, order } = value;

  const selectHandler = (_key: keyof ISortItem, _value: ISortItem[keyof ISortItem]) => {
    onSelect?.(index, { ...value, [_key]: _value });
  };

  return (
    <div className="flex py-2">
      <SortFieldSelect
        value={column}
        {...restProps}
        onSelect={(value) => selectHandler(ISortKey.COLUMN, value)}
      />

      <OrderSelect
        value={order}
        onSelect={(value) => selectHandler(ISortKey.ASCENDING, value)}
        column={column}
      />
    </div>
  );
}

export { SortItem };
