import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Record } from '@teable/sdk/model';
import { cn } from '@teable/ui-lib/shadcn';
import { memo } from 'react';
import type { ListChildComponentProps } from 'react-window';
import { KanbanCard } from './KanbanCard';

interface IKanbanItemProps {
  stackId: string;
  cards: Record[];
  skipIndex: number;
}

interface IKanbanItemDragContainerProps {
  card: Record;
  stackId: string;
}

const KanbanItemBase = (props: ListChildComponentProps<IKanbanItemProps>) => {
  const { index, style, data } = props;
  const { cards, stackId, skipIndex } = data;
  const virtualIndex = index - skipIndex;
  const card = cards[virtualIndex];

  return (
    <div style={style}>
      {card ? <KanbanItemDragContainer card={card} stackId={stackId} /> : null}
    </div>
  );
};

export const KanbanItem = memo(KanbanItemBase);

export const KanbanItemDragContainer = (props: IKanbanItemDragContainerProps) => {
  const { card, stackId } = props;
  const { id } = card;

  const { listeners, attributes, isDragging, transform, transition, setNodeRef } = useSortable({
    id,
    data: {
      stackId,
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
      className={cn('w-full cursor-grab px-3', isDragging && 'opacity-50')}
    >
      <KanbanCard card={card} />
    </div>
  );
};
