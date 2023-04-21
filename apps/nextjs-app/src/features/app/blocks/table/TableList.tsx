import { useTableId, useTables } from '@teable-group/sdk';
import AddBoldIcon from '@teable-group/ui-lib/icons/app/add-bold.svg';
import classnames from 'classnames';
import type { OnDragEndResponder } from 'react-beautiful-dnd';
import { DragDropContext, Droppable, Draggable, resetServerContext } from 'react-beautiful-dnd';
import { TableListItem } from './TableListItem';
import { useAddTable } from './useAddTable';

resetServerContext();

export const TableList: React.FC = () => {
  const tables = useTables();
  const tableId = useTableId();
  const addTable = useAddTable();

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

    table.updateOrder(newOrder);
  };

  return (
    <div className="py-2 flex flex-col overflow-hidden">
      <div className="mx-2 ">
        <button className="btn btn-xs btn-ghost btn-block" onClick={addTable}>
          <AddBoldIcon />
          <span className="ml-1">Table</span>
        </button>
      </div>
      <div className="overflow-y-auto">
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="droppable">
            {(provided) => (
              <ul
                {...provided.droppableProps}
                className="menu menu-compact"
                ref={provided.innerRef}
                style={{ listStyle: 'none', padding: 0 }}
              >
                {tables.map((table, index) => (
                  <Draggable key={table.id} draggableId={table.id} index={index}>
                    {(provided) => (
                      <li
                        className={classnames('group relative', { bordered: table.id === tableId })}
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
        </DragDropContext>
      </div>
    </div>
  );
};
