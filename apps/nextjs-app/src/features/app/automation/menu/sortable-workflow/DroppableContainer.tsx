import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IWorkflow } from '@teable/core';
import { cn } from '@teable/ui-lib';
import React from 'react';
import { CollapseContainer } from './CollapseContainer';

interface IDroppableContainer {
  id: string;
  children: React.ReactElement;
}

const DroppableContainer = (
  props: IDroppableContainer & {
    workFlow: IWorkflow;
    name: string;
  }
) => {
  const { id, children, workFlow, name } = props;
  const sortProps = useSortable({
    id: id,
    data: {
      type: 'container',
    },
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, over, active } =
    sortProps;
  const mergedTransform = transform ? { ...transform, scaleX: 1, scaleY: 1 } : null;
  const style = {
    transform: CSS.Transform.toString(mergedTransform),
    scale: 'scaleY(1)',
    transition: transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isNotContainer = active?.data.current?.type !== 'container';
  const isOverContainer =
    isNotContainer && over
      ? id === over.id || workFlow.map(({ id }) => id).includes(over?.id as string)
      : false;

  return (
    <CollapseContainer
      id={id}
      style={style}
      ref={setNodeRef}
      handleProps={{
        ...attributes,
        ...listeners,
      }}
      className={cn(
        'w-full box-border border-2',
        isOverContainer ? 'border-2 rounded-sm border-secondary' : 'border-transparent'
      )}
      workflow={workFlow}
      name={name}
      hover={isOverContainer}
      isDragging={isDragging}
    >
      {children}
    </CollapseContainer>
  );
};

export { DroppableContainer };
