import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface IDraggableContainerProps {
  id: string;
  children: (
    setNodeRef: (node: HTMLElement | null) => void,
    handleProps: React.HTMLAttributes<HTMLDivElement>,
    isDragging: boolean
  ) => React.ReactElement;
  className?: string;
}
const DraggableContainer = (props: IDraggableContainerProps) => {
  const { id, children, className } = props;

  const sortProps = useSortable({
    id: id,
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortProps;
  const customTransform = transform ? { ...transform, scaleX: 1, scaleY: 1 } : null;
  const style = {
    transform: CSS.Transform.toString(customTransform),
    transition,
  };
  const handleProps = {
    ...attributes,
    ...listeners,
  };

  return (
    <div style={style} className={className}>
      {children(setNodeRef, handleProps, isDragging)}
    </div>
  );
};

export { DraggableContainer };
