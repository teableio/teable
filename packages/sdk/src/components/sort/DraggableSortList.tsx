import type { ISort, ISortItem } from '@teable/core';
import { DraggableHandle, Trash2 } from '@teable/icons';
import { Button, cn, DndKitContext, Droppable, Draggable } from '@teable/ui-lib';
import type { DraggableAttributes, SyntheticListenerMap, DragEndEvent } from '@teable/ui-lib';
import { useIsHydrated } from '../../hooks';
import { SortItem } from './SortItem';
import type { ISortItemProps } from './SortItem';

interface IDraggbleProps {
  deleteHandler: (index: number) => void;
  displayDragHandler: boolean;
  attributes?: DraggableAttributes;
  listeners?: SyntheticListenerMap;
}

interface IDraggableSortProps {
  sorts: NonNullable<ISort>['sortObjs'];
  selectedFields: string[];
  onChange: (sorts: NonNullable<ISort>['sortObjs']) => void;
}

function DraggableItem(props: IDraggbleProps & ISortItemProps) {
  const {
    value,
    index,
    onSelect,
    deleteHandler,
    selectedFields,
    displayDragHandler,
    attributes,
    listeners,
  } = props;

  return (
    <>
      <SortItem value={value} index={index} onSelect={onSelect} selectedFields={selectedFields} />

      <Button variant="outline" size="sm" onClick={() => deleteHandler(index)}>
        <Trash2 className="size-4"></Trash2>
      </Button>

      <div
        className={cn('pl-2', displayDragHandler ? null : 'hidden')}
        {...attributes}
        {...listeners}
      >
        <DraggableHandle />
      </div>
    </>
  );
}

function DraggableSortList(props: IDraggableSortProps) {
  const { sorts, onChange, selectedFields } = props;
  const isHydrated = useIsHydrated();

  const deleteHandler = (index: number) => {
    const newSorts = [...sorts];
    newSorts.splice(index, 1);
    onChange(newSorts);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const newSorts = [...sorts];
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;
    if (!over) {
      return;
    }
    newSorts.splice(to, 0, ...newSorts.splice(from, 1));
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
    <DndKitContext onDragEnd={handleDragEnd}>
      {isHydrated && (
        <Droppable items={sorts.map(({ fieldId }) => ({ id: fieldId }))}>
          {sorts.map((sort, index) => (
            <Draggable key={sort.fieldId} id={sort.fieldId}>
              {({ setNodeRef, style, isDragging, listeners, attributes }) => (
                <div
                  ref={setNodeRef}
                  style={style}
                  className={cn(
                    'flex items-center bg-card my-2 flex-nowrap',
                    isDragging ? 'opacity-50' : null
                  )}
                >
                  <DraggableItem
                    value={sort}
                    index={index}
                    key={sort.fieldId}
                    onSelect={selectHandler}
                    deleteHandler={deleteHandler}
                    selectedFields={selectedFields}
                    displayDragHandler={sorts.length > 1}
                    attributes={attributes}
                    listeners={listeners}
                  ></DraggableItem>
                </div>
              )}
            </Draggable>
          ))}
        </Droppable>
      )}
    </DndKitContext>
  );
}

export { DraggableSortList };
