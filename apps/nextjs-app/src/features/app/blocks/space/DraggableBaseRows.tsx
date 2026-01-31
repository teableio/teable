import type { IGetBaseVo } from '@teable/openapi';
import type { DragEndEvent } from '@teable/ui-lib/base';
import {
  DndKitContext,
  Draggable,
  Droppable,
  verticalListSortingStrategy,
} from '@teable/ui-lib/base';
import { cn } from '@teable/ui-lib/shadcn';
import { useState } from 'react';

interface IDraggableBaseRowsProps {
  className?: string;
  items: (IGetBaseVo & { lastVisitTime?: string })[];
  onDragEnd: (event: DragEndEvent) => void;
  renderRow: (
    base: IGetBaseVo & { lastVisitTime?: string },
    options: { showDragHandle: boolean; isDragging?: boolean; listeners?: Record<string, unknown> }
  ) => React.ReactNode;
}

export const DraggableBaseRows = (props: IDraggableBaseRowsProps) => {
  const { className, items, onDragEnd, renderRow } = props;
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeItem = activeId ? items.find((item) => item.id === activeId) : null;

  return (
    <DndKitContext
      onDragStart={(event) => setActiveId(String(event.active.id))}
      onDragEnd={(event) => {
        onDragEnd(event);
        setActiveId(null);
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <Droppable items={items.map((base) => base.id)} strategy={verticalListSortingStrategy}>
        <div className={cn('divide-y', className)}>
          {items.map((base) => (
            <Draggable key={base.id} id={base.id}>
              {({ setNodeRef, attributes, listeners, style, isDragging }) => (
                <div
                  ref={setNodeRef}
                  {...attributes}
                  style={style}
                  className={cn(
                    'transition-opacity duration-200',
                    isDragging && 'opacity-40 bg-muted'
                  )}
                >
                  {renderRow(base, { showDragHandle: true, isDragging, listeners })}
                </div>
              )}
            </Draggable>
          ))}
        </div>
      </Droppable>
    </DndKitContext>
  );
};
