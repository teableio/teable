import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IFieldInstance } from '@teable/sdk/model';
import { cn } from '@teable/ui-lib/shadcn';
import React from 'react';

export const SortableItem = (props: {
  id: string;
  index: number;
  field: IFieldInstance;
  children: React.ReactElement;
  className?: string;
  draggingClassName?: string;
  onClick?: () => void;
}) => {
  const { id, index, field, children, className, draggingClassName, onClick } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: {
      id,
      index,
      field,
    },
  });

  const itemStyle = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      style={itemStyle}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'group relative overflow-y-auto',
        className,
        isDragging ? draggingClassName : null
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
};
