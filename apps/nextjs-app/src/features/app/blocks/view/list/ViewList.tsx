import { useTablePermission, useViewId, useViews, useIsHydrated } from '@teable/sdk';
import { horizontalListSortingStrategy } from '@teable/ui-lib/base/dnd-kit';
import { cn } from '@teable/ui-lib/shadcn';
import { DraggableWrapper } from './DraggableWrapper';
import { ViewListItem } from './ViewListItem';

export const ViewList = () => {
  const views = useViews();
  const activeViewId = useViewId();
  const isHydrated = useIsHydrated();
  const permission = useTablePermission();

  return isHydrated ? (
    views.length ? (
      <DraggableWrapper strategy={horizontalListSortingStrategy}>
        {({ setNodeRef, attributes, listeners, style, isDragging, view }) => (
          <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            style={style}
            className={cn('relative', {
              'opacity-50': isDragging,
            })}
          >
            <ViewListItem
              view={view}
              removable={!!permission['view|delete'] && views.length > 1}
              isActive={view.id === activeViewId}
            />
          </div>
        )}
      </DraggableWrapper>
    ) : (
      <></>
    )
  ) : (
    <>
      {views.map((view) => (
        <ViewListItem
          key={view.id}
          view={view}
          removable={!!permission['view|delete'] && views.length > 1}
          isActive={view.id === activeViewId}
        />
      ))}
    </>
  );
};
