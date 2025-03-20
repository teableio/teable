import { useTableId, useTables, useIsHydrated } from '@teable/sdk';
import {
  DndKitContext,
  Droppable,
  Draggable,
  type DragEndEvent,
} from '@teable/ui-lib/base/dnd-kit';
import { cn } from '@teable/ui-lib/shadcn';
import { useState, useEffect } from 'react';
import { TableListItem } from './TableListItem';
import { useTableHref } from './useTableHref';

export const DraggableList = () => {
  const tables = useTables();

  const tableId = useTableId();

  const isHydrated = useIsHydrated();

  const [innerTables, setInnerTables] = useState([...tables]);

  const tableHrefMap = useTableHref();

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
    list.splice(to, 0, table);
    setInnerTables(list);
    const tableIndex = list.findIndex((v) => v.id === table.id);
    if (tableIndex == 0) {
      await table.updateOrder({ anchorId: list[1].id, position: 'before' });
    } else {
      await table.updateOrder({ anchorId: list[tableIndex - 1].id, position: 'after' });
    }
  };

  return isHydrated ? (
    <DndKitContext onDragEnd={onDragEnd}>
      <Droppable items={innerTables.map(({ id }) => ({ id }))}>
        {innerTables.map((table) => (
          <Draggable key={table.id} id={table.id} disabled={!table.permission?.['table|update']}>
            {({ setNodeRef, attributes, listeners, style, isDragging }) => (
              <div
                ref={setNodeRef}
                {...attributes}
                {...listeners}
                style={style}
                className={cn('group relative overflow-y-auto cursor-pointer', {
                  'opacity-60': isDragging,
                })}
              >
                <TableListItem
                  href={tableHrefMap[table.id]}
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
