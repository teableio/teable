import { useTableId, useTables, useIsHydrated } from '@teable-group/sdk';
import type { OnDragEndResponder } from 'react-beautiful-dnd';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { TableListItem } from './TableListItem';

export const DraggableList: React.FC = () => {
  const tables = useTables();
  const tableId = useTableId();

  const isHydrated = useIsHydrated();

  const onDragEnd: OnDragEndResponder = (result) => {
    if (!result.destination) return;

    let newOrder = 0;
    const list = [...tables];
    const [table] = list.splice(result.source.index, 1);
    const newIndex = result.destination.index;

    if (newIndex === 0) {
      newOrder = list[0].order - 1;
    } else if (newIndex > list.length - 1) {
      newOrder = list[list.length - 1].order + 1;
    } else {
      const prevOrder = list[newIndex - 1].order;
      const nextOrder = list[newIndex].order;
      newOrder = (prevOrder + nextOrder) / 2;
    }

    if (newOrder === table.order) {
      return;
    }

    table.updateOrder(newOrder);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      {isHydrated && (
        <Droppable droppableId="droppable">
          {(provided) => (
            <ul
              {...provided.droppableProps}
              ref={provided.innerRef}
              style={{ listStyle: 'none', padding: 0 }}
            >
              {tables.map((table, index) => (
                <Draggable key={table.id} draggableId={table.id} index={index}>
                  {(provided) => (
                    <li
                      className="group relative"
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      style={{
                        ...provided.draggableProps.style,
                      }}
                    >
                      <TableListItem table={table} isActive={table.id === tableId} />
                    </li>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </ul>
          )}
        </Droppable>
      )}
    </DragDropContext>
  );
};
