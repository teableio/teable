'use client';

import { useIsHydrated } from '@teable/sdk/hooks';
import { useCellAttachmentUploadStore } from '@teable/sdk/store/use-attachment-upload-store';
import { cn } from '@teable/ui-lib';
import { useEffect, useRef, useState } from 'react';
import { UploadProgressBubble } from './UploadProgressBubble';
import { UploadTaskList } from './UploadTaskList';

export const UploadProgressPanel = () => {
  const isHydrated = useIsHydrated();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousTaskCountRef = useRef(0);

  const allTasks = useCellAttachmentUploadStore((state) => state.getAllActiveTasks());
  const hasActiveUploads = useCellAttachmentUploadStore((state) => state.hasActiveUploads());
  const hasAnyTasks = allTasks.length > 0;
  const clearCompletedTasks = useCellAttachmentUploadStore((state) => state.clearCompletedTasks);
  const clearErrorTasks = useCellAttachmentUploadStore((state) => state.clearErrorTasks);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded]);

  useEffect(() => {
    if (allTasks.length > 0 && allTasks.length > previousTaskCountRef.current) {
      setIsVisible(true);
    }
    previousTaskCountRef.current = allTasks.length;
  }, [allTasks.length]);

  // Warn user when trying to leave page with active uploads
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasActiveUploads) {
        event.preventDefault();
        // Legacy support: some older browsers require returnValue to be set
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasActiveUploads]);

  if (!isHydrated || !hasAnyTasks || !isVisible) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={cn('absolute bottom-5 right-5 z-50 w-[340px]', 'transition-opacity duration-200')}
    >
      <div className="overflow-hidden rounded-lg border bg-background shadow-md">
        <UploadProgressBubble
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded((prev) => !prev)}
          onClose={() => {
            setIsVisible(false);
            clearCompletedTasks();
            clearErrorTasks();
          }}
        />
        <UploadTaskList isExpanded={isExpanded} />
      </div>
    </div>
  );
};
