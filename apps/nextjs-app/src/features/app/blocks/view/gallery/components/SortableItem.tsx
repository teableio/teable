import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SortableProps {
  id: string;
  children: React.ReactNode;
}

export const SortableItem = (props: SortableProps) => {
  const { id, children } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    flex: 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="overflow-hidden rounded-md shadow-sm transition-shadow duration-200 ease-out hover:shadow-lg"
    >
      {children}
    </div>
  );
};
