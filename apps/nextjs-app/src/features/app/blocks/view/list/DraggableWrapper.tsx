import type { IViewInstance } from '@teable/sdk';
import { useViews } from '@teable/sdk';
import { DndKitContext, Draggable, Droppable } from '@teable/ui-lib/base/dnd-kit';
import type { SortingStrategy, DragEndEvent, useSortable } from '@teable/ui-lib/base/dnd-kit';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

type IProvidedProps = ReturnType<typeof useSortable> & {
  style: React.CSSProperties;
  view: IViewInstance;
};

export const DraggableWrapper = ({
  strategy,
  children,
}: {
  strategy: SortingStrategy;
  children: (props: IProvidedProps) => ReactElement;
}) => {
  const views = useViews();

  const [innerViews, setInnerViews] = useState([...views]);

  useEffect(() => {
    setInnerViews(views);
  }, [views]);

  const onDragEndHandler = async (event: DragEndEvent) => {
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;
    const newViews = [...innerViews];

    const [moveView] = newViews.splice(from, 1);

    if (!over) {
      return;
    }

    const view = views[from];

    newViews.splice(to, 0, moveView);

    setInnerViews(newViews);
    const viewIndex = newViews.findIndex((v) => v.id === view.id);

    if (viewIndex == 0) {
      await view?.updateOrder({ anchorId: newViews[1].id, position: 'before' });
    } else {
      await view?.updateOrder({ anchorId: newViews[viewIndex - 1].id, position: 'after' });
    }
  };

  return (
    <DndKitContext onDragEnd={onDragEndHandler}>
      <Droppable items={innerViews.map(({ id }) => ({ id }))} strategy={strategy}>
        {innerViews.map((view) => (
          <Draggable key={view.id} id={view.id}>
            {(props) => children({ ...props, view })}
          </Draggable>
        ))}
      </Droppable>
    </DndKitContext>
  );
};
