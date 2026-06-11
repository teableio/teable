'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useCellAttachmentUploadStore } from '@teable/sdk/store/use-attachment-upload-store';
import { cn, ScrollArea } from '@teable/ui-lib';
import { memo, useRef } from 'react';
import { TaskItem } from './TaskItem';

interface IUploadTaskListProps {
  isExpanded: boolean;
}

const TaskListContent = memo(() => {
  const allTasks = useCellAttachmentUploadStore((state) => state.getAllActiveTasks());
  const cancelTask = useCellAttachmentUploadStore((state) => state.cancelTask);
  const removeTask = useCellAttachmentUploadStore((state) => state.removeTask);
  const retryTask = useCellAttachmentUploadStore((state) => state.retryTask);

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: allTasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 3,
    getItemKey: (index) => allTasks[index].id,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <ScrollArea
      viewportRef={parentRef}
      className="max-h-80 w-full [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-w-0"
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-virtual-index={virtualItem.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <TaskItem
              key={virtualItem.index}
              task={allTasks[virtualItem.index]}
              onCancel={() =>
                cancelTask(allTasks[virtualItem.index].cellKey, allTasks[virtualItem.index].id)
              }
              onRemove={() =>
                removeTask(allTasks[virtualItem.index].cellKey, allTasks[virtualItem.index].id)
              }
              onRetry={() =>
                retryTask(allTasks[virtualItem.index].cellKey, allTasks[virtualItem.index].id)
              }
            />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
});

TaskListContent.displayName = 'TaskListContent';

export const UploadTaskList = ({ isExpanded }: IUploadTaskListProps) => {
  return (
    <div
      className={cn(
        'transition-[max-height] duration-200 ease-out flex h-full overflow-hidden max-h-0',
        {
          'border-t max-h-80': isExpanded,
        }
      )}
    >
      <TaskListContent />
    </div>
  );
};
