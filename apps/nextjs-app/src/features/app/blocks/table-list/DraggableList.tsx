import type { DragStartEvent, DragEndEvent, UniqueIdentifier } from '@dnd-kit/core';
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { useSortable, SortableContext } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTableId, useTables, useIsHydrated } from '@teable-group/sdk';
import classNames from 'classnames';
import { isEqual } from 'lodash';
import { useState, useEffect } from 'react';
import { TableListItem } from './TableListItem';

const DraggableContainer = (props: { children: React.ReactElement; id: string }) => {
  const { id, children } = props;
  const dragProps = useSortable({ id });
  const { setNodeRef, transition, transform, attributes, listeners, isDragging } = dragProps;
  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  return (
    <div
      style={style}
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={classNames('group relative overflow-y-auto', isDragging ? 'opacity-60' : null)}
    >
      {children}
    </div>
  );
};

export const DraggableList: React.FC = () => {
  const tables = useTables();
  const tableId = useTableId();

  const isHydrated = useIsHydrated();
  const [draggingId, setDraggingId] = useState<UniqueIdentifier | null>('');

  const [innerTables, setInnerTables] = useState([...tables]);
  useEffect(() => {
    if (!isEqual(innerTables, tables)) {
      setInnerTables([...tables]);
    }
  }, [innerTables, tables]);

  const onDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setDraggingId(active.id);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;

    if (!over) {
      return;
    }

    let newOrder = 0;
    const list = [...innerTables];
    const [table] = list.splice(from, 1);
    if (to === 0) {
      newOrder = list[0].order - 1;
    } else if (to > list.length - 1) {
      newOrder = list[list.length - 1].order + 1;
    } else {
      const prevOrder = list[to - 1].order;
      const nextOrder = list[to].order;
      newOrder = (prevOrder + nextOrder) / 2;
    }
    if (newOrder === table.order) {
      return;
    }

    table.updateOrder(newOrder);
    list.splice(to, 0, table);
    setInnerTables(list);

    setDraggingId(null);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const overLayRender = () => {
    const table = tables.find(({ id }) => id === draggingId);
    if (!table) {
      return null;
    }
    return <TableListItem isActive={false} table={table} />;
  };

  return isHydrated ? (
    <DndContext onDragEnd={onDragEnd} onDragStart={onDragStart} sensors={sensors}>
      <SortableContext items={innerTables}>
        {innerTables.map((table) => (
          <DraggableContainer key={table.id} id={table.id}>
            <TableListItem table={table} isActive={table.id === tableId} />
          </DraggableContainer>
        ))}
        {<DragOverlay>{overLayRender()}</DragOverlay>}
      </SortableContext>
    </DndContext>
  ) : null;
};
