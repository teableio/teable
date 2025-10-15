import { useTablePermission, useViewId, useViews, useIsHydrated } from '@teable/sdk';
import { horizontalListSortingStrategy } from '@teable/ui-lib/base/dnd-kit';
import { cn } from '@teable/ui-lib/shadcn';
import { useState } from 'react';
import { DraggableWrapper } from './DraggableWrapper';
import { ViewListItem } from './ViewListItem';

export const ViewList = () => {
  const views = useViews();
  const activeViewId = useViewId();
  const isHydrated = useIsHydrated();
  const permission = useTablePermission();
  const [editing, setEditing] = useState(false);

  return isHydrated ? (
    views.length ? (
      <DraggableWrapper strategy={horizontalListSortingStrategy}>
        {({ setNodeRef, attributes, listeners, style, isDragging, view }) => (
          <div
            ref={setNodeRef}
            {...attributes}
            {...(editing ? {} : listeners)}
            style={style}
            className={cn('relative', {
              'opacity-50': isDragging,
            })}
          >
            <ViewListItem
              onEdit={(value) => setEditing(value)}
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
          onEdit={(value) => setEditing(value)}
          view={view}
          removable={!!permission['view|delete'] && views.length > 1}
          isActive={view.id === activeViewId}
        />
      ))}
    </>
  );
};
