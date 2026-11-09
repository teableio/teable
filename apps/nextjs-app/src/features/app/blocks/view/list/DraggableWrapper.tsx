import type { IViewInstance } from '@teable/sdk';
import { useViews } from '@teable/sdk';
import { DndKitContext, Draggable, Droppable } from '@teable/ui-lib/base/dnd-kit';
import type { SortingStrategy, DragEndEvent, useSortable } from '@teable/ui-lib/base/dnd-kit';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

type IProvidedProps = ReturnType<typeof useSortable> & {
  style: React.CSSProperties;
  view: IViewInstance;
  /** With `firstIds`, which group's first row this view is, to head it with a title. */
  groupStart?: 'first' | 'rest';
};

/**
 * `firstIds`: views listed ahead of the rest (the reader's starred views), each group keeping the
 * views' shared order. A view moves only within its own group. `renderOverlay` draws the row that
 * follows the pointer, in place of a copy of the list's row.
 */
export const DraggableWrapper = ({
  strategy,
  children,
  firstIds,
  renderOverlay,
}: {
  strategy: SortingStrategy;
  children: (props: IProvidedProps) => ReactElement;
  firstIds?: string[];
  renderOverlay?: (view: IViewInstance) => ReactElement;
}) => {
  const views = useViews();
  const firstKey = firstIds?.join(',');
  const orderedViews = useMemo(() => {
    const first = new Set(firstKey ? firstKey.split(',') : []);
    if (!first.size) return views;
    return [...views.filter((v) => first.has(v.id)), ...views.filter((v) => !first.has(v.id))];
  }, [views, firstKey]);

  const [innerViews, setInnerViews] = useState([...orderedViews]);

  useEffect(() => {
    setInnerViews(orderedViews);
  }, [orderedViews]);

  const groupStartOf = (index: number): IProvidedProps['groupStart'] => {
    if (!firstIds?.length) return undefined;
    const isFirst = (i: number) => firstIds.includes(innerViews[i].id);
    if (index > 0 && isFirst(index) === isFirst(index - 1)) return undefined;
    return isFirst(index) ? 'first' : 'rest';
  };

  const onDragEndHandler = async (event: DragEndEvent) => {
    const { over, active } = event;
    const to = over?.data?.current?.sortable?.index;
    const from = active?.data?.current?.sortable?.index;

    if (!over || from === to) {
      return;
    }

    const view = innerViews[from];
    const isFirst = (id: string) => Boolean(firstIds?.includes(id));
    if (isFirst(view.id) !== isFirst(innerViews[to].id)) return;

    const newViews = [...innerViews];
    newViews.splice(from, 1);
    newViews.splice(to, 0, view);
    setInnerViews(newViews);

    // Anchor on a neighbour in the same group, so the move never crosses into the other one.
    const group = newViews.filter((v) => isFirst(v.id) === isFirst(view.id));
    const groupIndex = group.findIndex((v) => v.id === view.id);
    if (groupIndex === 0) {
      await view.updateOrder({ anchorId: group[1].id, position: 'before' });
    } else {
      await view.updateOrder({ anchorId: group[groupIndex - 1].id, position: 'after' });
    }
  };

  return (
    <DndKitContext onDragEnd={onDragEndHandler}>
      <Droppable
        items={innerViews.map(({ id }) => ({ id }))}
        strategy={strategy}
        overlayRender={
          renderOverlay
            ? (active) => {
                const view = innerViews.find(({ id }) => id === active?.id);
                return view ? renderOverlay(view) : <></>;
              }
            : undefined
        }
      >
        {innerViews.map((view, index) => (
          <Draggable key={view.id} id={view.id}>
            {(props) => children({ ...props, view, groupStart: groupStartOf(index) })}
          </Draggable>
        ))}
      </Droppable>
    </DndKitContext>
  );
};
