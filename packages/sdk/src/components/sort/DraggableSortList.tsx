import type { ISort, ISortItem } from '@teable-group/core';
import { DraggableHandle, Trash2 } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib';
import classNames from 'classnames';
import type { OnDragEndResponder } from 'react-beautiful-dnd';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { useIsHydrated } from '../../hooks';
import { SortItem } from './SortItem';

interface IDraggableSortProps {
  sorts: ISort['sortObjs'];
  selectedFields: string[];
  onChange: (sorts: ISort['sortObjs']) => void;
}

function DraggableSortList(props: IDraggableSortProps) {
  const { sorts, onChange, selectedFields } = props;
  const isHydrated = useIsHydrated();

  const onDragEnd: OnDragEndResponder = (result) => {
    if (!result.destination) return;

    const {
      source: { index: from },
      destination: { index: to },
    } = result;

    const newSorts = [...sorts];

    newSorts.splice(to, 0, ...newSorts.splice(from, 1));

    onChange(newSorts);
  };
  const deleteHandler = (index: number) => {
    const newSorts = [...sorts];
    newSorts.splice(index, 1);
    onChange(newSorts);
  };
  const selectHandler = (index: number, item: ISortItem) => {
    const newSorts = [...sorts];
    newSorts.splice(index, 1, {
      ...item,
    });
    onChange(newSorts);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      {isHydrated && (
        <Droppable droppableId="droppable">
          {(provided) => (
            <ul
              {...provided.droppableProps}
              ref={provided.innerRef}
              style={{ listStyle: 'none', padding: 0, height: 'auto' }}
            >
              {sorts.map((sort, index) => (
                <Draggable key={sort.column} draggableId={sort.column} index={index}>
                  {(provided) => (
                    <li
                      className="flex items-center"
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      style={{
                        ...provided.draggableProps.style,
                        // fix position error when dragging
                        top: 'auto',
                        left: 'auto',
                      }}
                    >
                      <SortItem
                        key={sort.column}
                        value={sort}
                        index={index}
                        onSelect={selectHandler}
                        selectedFields={selectedFields}
                      />

                      <Button variant="outline" size="sm" onClick={() => deleteHandler(index)}>
                        <Trash2 className="h-4 w-4"></Trash2>
                      </Button>

                      <div
                        {...provided.dragHandleProps}
                        className={classNames('pl-2', sorts.length > 1 ? '' : 'hidden')}
                      >
                        <DraggableHandle />
                      </div>
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
}

export { DraggableSortList };
