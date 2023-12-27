import { DndContext, DragOverlay } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent, UniqueIdentifier } from '@dnd-kit/core';
import { useSortable, SortableContext } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ISort, ISortItem } from '@teable-group/core';
import { DraggableHandle, Trash2 } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsHydrated } from '../../hooks';
import { SortItem } from './SortItem';
import type { ISortItemProps } from './SortItem';

interface IDraggbleProps {
  deleteHandler: (index: number) => void;
  displayDragHandler: boolean;
}

interface IDraggableSortProps {
  sorts: NonNullable<ISort>['sortObjs'];
  selectedFields: string[];
  onChange: (sorts: NonNullable<ISort>['sortObjs']) => void;
}

function DraggableItem(props: IDraggbleProps & ISortItemProps) {
  const { value, index, onSelect, deleteHandler, selectedFields, displayDragHandler } = props;
  const dragProps = useSortable({
    id: value.fieldId,
  });
  const { setNodeRef, transition, transform, isDragging, attributes, listeners } = dragProps;

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={classNames('flex items-center bg-card my-2', isDragging ? 'opacity-50' : null)}
    >
      <SortItem value={value} index={index} onSelect={onSelect} selectedFields={selectedFields} />

      <Button variant="outline" size="sm" onClick={() => deleteHandler(index)}>
        <Trash2 className="h-4 w-4"></Trash2>
      </Button>

      <div
        className={classNames('pl-2 cursor-pointer', displayDragHandler ? null : 'hidden')}
        {...attributes}
        {...listeners}
      >
        <DraggableHandle />
      </div>
    </div>
  );
}

function DraggableSortList(props: IDraggableSortProps) {
  const { sorts, onChange, selectedFields } = props;
  const isHydrated = useIsHydrated();
  const [draggingId, setDraggingId] = useState<UniqueIdentifier | null>(null);

  const deleteHandler = (index: number) => {
    const newSorts = [...sorts];
    newSorts.splice(index, 1);
    onChange(newSorts);
  };
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    active.id && setDraggingId(active.id);
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
    setDraggingId(null);
  };
  const selectHandler = (index: number, item: ISortItem) => {
    const newSorts = [...sorts];
    newSorts.splice(index, 1, {
      ...item,
    });
    onChange(newSorts);
  };
  const renderDragOverlay = () => {
    const index = sorts.findIndex(({ fieldId }) => fieldId === draggingId);
    const sort = sorts[index];
    return sort ? (
      <DraggableItem
        value={sort}
        index={index}
        onSelect={selectHandler}
        deleteHandler={deleteHandler}
        selectedFields={selectedFields}
        displayDragHandler={sorts.length > 1}
      ></DraggableItem>
    ) : null;
  };

  return (
    <DndContext onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
      {isHydrated && (
        <SortableContext items={sorts.map(({ fieldId }) => ({ id: fieldId }))}>
          {sorts.map((sort, index) => (
            <DraggableItem
              value={sort}
              index={index}
              key={sort.fieldId}
              onSelect={selectHandler}
              deleteHandler={deleteHandler}
              selectedFields={selectedFields}
              displayDragHandler={sorts.length > 1}
            ></DraggableItem>
          ))}
          {createPortal(<DragOverlay>{renderDragOverlay()}</DragOverlay>, document.body)}
        </SortableContext>
      )}
    </DndContext>
  );
}

export { DraggableSortList };
