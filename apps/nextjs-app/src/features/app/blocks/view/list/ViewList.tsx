import { useTablePermission, useViewId, useViews, useIsHydrated } from '@teable/sdk';
import { horizontalListSortingStrategy } from '@teable/ui-lib/base/dnd-kit';
import { cn } from '@teable/ui-lib/shadcn';
import { useState } from 'react';
import { useCompactResourceChrome } from '@/features/app/hooks/useCompactResourceChrome';
import { DraggableWrapper } from './DraggableWrapper';
import { ViewListItem } from './ViewListItem';

/** `listOpen`: compact chrome's title opens the view list; whether that list is open. */
export const ViewList = ({ listOpen }: { listOpen?: boolean }) => {
  const views = useViews();
  const activeViewId = useViewId();
  const isHydrated = useIsHydrated();
  const permission = useTablePermission();
  const editable = permission['view|update'];
  const [editing, setEditing] = useState(false);
  const compact = useCompactResourceChrome();

  // Compact chrome shows the current view alone, as a title whose click opens the view list to
  // switch views; a right-click still opens the current view's menu.
  if (compact) {
    const activeView = views.find((view) => view.id === activeViewId);
    return activeView ? (
      <ViewListItem
        onEdit={(value) => setEditing(value)}
        view={activeView}
        removable={!!permission['view|delete'] && views.length > 1}
        isActive
        asListTrigger
        listOpen={listOpen}
      />
    ) : null;
  }

  return isHydrated && editable ? (
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
