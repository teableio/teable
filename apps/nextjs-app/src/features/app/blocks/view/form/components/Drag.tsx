/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import type { UniqueIdentifier } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IFieldInstance } from '@teable/sdk/model';
import classNames from 'classnames';
import React from 'react';

export const DraggableItem = (props: {
  id: string;
  field: IFieldInstance;
  children: React.ReactElement;
  className?: string;
  draggingClassName?: string;
}) => {
  const { id, field, children, className, draggingClassName } = props;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: {
      field,
      fromSidebar: true,
    },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={classNames(
        'group relative overflow-y-auto',
        className,
        isDragging ? draggingClassName : null
      )}
    >
      {children}
    </div>
  );
};

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
    <div
      style={itemStyle}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={classNames(
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

export const DroppableContainer = ({
  id,
  items,
  children,
  style,
  ...props
}: {
  id: UniqueIdentifier;
  items: { id: UniqueIdentifier }[];
  children: React.ReactElement;
  style?: React.CSSProperties;
}) => {
  const { attributes, isDragging, listeners, setNodeRef, transition, transform } = useSortable({
    id,
    data: {
      parent: null,
      isContainer: true,
    },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        ...style,
        transition,
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : undefined,
        minHeight: 50,
      }}
      {...props}
    >
      {children}
    </div>
  );
};
