import { useTablePermission, useViewId, useViews, useIsHydrated } from '@teable/sdk';
import { swapReorder } from '@teable/sdk/utils';
import {
  DndKitContext,
  Draggable,
  Droppable,
  horizontalListSortingStrategy,
  type DragEndEvent,
} from '@teable/ui-lib/base/dnd-kit';
import classNames from 'classnames';
import { useEffect, useState } from 'react';
import { ViewListItem } from './ViewListItem';

export const DraggableViewList = () => {
  const views = useViews();
  const activeViewId = useViewId();
  const isHydrated = useIsHydrated();
  const permission = useTablePermission();

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

    const newOrder = swapReorder(1, from, to, views?.length, (index) => views?.[index].order)[0];

    const view = views[from];

    newViews.splice(to, 0, moveView);

    setInnerViews(newViews);

    await view?.updateOrder(newOrder);
  };

  return isHydrated ? (
    <DndKitContext onDragEnd={onDragEndHandler}>
      <Droppable
        items={innerViews.map(({ id }) => ({ id }))}
        strategy={horizontalListSortingStrategy}
      >
        {innerViews.map((view) => (
          <Draggable key={view.id} id={view.id}>
            {({ setNodeRef, style, attributes, listeners, isDragging }) => (
              <div
                ref={setNodeRef}
                {...attributes}
                {...listeners}
                style={style}
                className={classNames('relative', {
                  'opacity-50': isDragging,
                })}
              >
                <ViewListItem
                  view={view}
                  removable={permission['view|delete'] && views.length > 1}
                  isActive={view.id === activeViewId}
                />
              </div>
            )}
          </Draggable>
        ))}
      </Droppable>
    </DndKitContext>
  ) : null;
};
