import { useTableId, useTables, useIsHydrated, swapReorder } from '@teable/sdk';
import {
  DndKitContext,
  Droppable,
  Draggable,
  type DragEndEvent,
} from '@teable/ui-lib/base/dnd-kit';
import classNames from 'classnames';
import { useState, useEffect } from 'react';
import { TableListItem } from './TableListItem';

export const DraggableList = () => {
  const tables = useTables();

  const tableId = useTableId();

  const isHydrated = useIsHydrated();

  const [innerTables, setInnerTables] = useState([...tables]);

  useEffect(() => {
    setInnerTables(tables);
  }, [tables]);

  const onDragEnd = async (event: DragEndEvent) => {
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;

    if (!over) {
      return;
    }

    const list = [...tables];
    const [table] = list.splice(from, 1);

    const newOrder = swapReorder(1, from, to, tables.length, (index: number) => {
      return tables[index].order;
    })[0];

    if (newOrder === table.order) {
      return;
    }
    list.splice(to, 0, table);
    setInnerTables(list);
    table.updateOrder(newOrder);
  };

  return isHydrated ? (
    <DndKitContext onDragEnd={onDragEnd}>
      <Droppable items={innerTables.map(({ id }) => ({ id }))}>
        {innerTables.map((table) => (
          <Draggable key={table.id} id={table.id}>
            {({ setNodeRef, attributes, listeners, style, isDragging }) => (
              <div
                ref={setNodeRef}
                {...attributes}
                {...listeners}
                style={style}
                className={classNames('group relative overflow-y-auto cursor-pointer', {
                  'opacity-60': isDragging,
                })}
              >
                <TableListItem
                  table={table}
                  isActive={table.id === tableId}
                  isDragging={isDragging}
                />
              </div>
            )}
          </Draggable>
        ))}
      </Droppable>
    </DndKitContext>
  ) : null;
};
