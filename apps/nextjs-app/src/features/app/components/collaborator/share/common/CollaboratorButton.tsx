import { ChevronRight } from '@teable/icons';
import type { CollaboratorItem } from '@teable/openapi';
import { forwardRef } from 'react';
import { PreviewCollaborators } from './PreviewCollaborators';

export const CollaboratorButton = forwardRef<
  HTMLDivElement,
  {
    collaborators: CollaboratorItem[];
    onClick: () => void;
    total: number;
  }
>(({ collaborators, total, onClick }, ref) => {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={ref}
      onClick={onClick}
      className="inline-flex h-12 w-full cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-md p-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground dark:bg-white/5 dark:hover:bg-white/10"
    >
      <div className="flex items-center gap-2">
        <PreviewCollaborators collaborators={collaborators || []} total={total} />
        <p>have access</p>
      </div>
      <ChevronRight className="size-4" />
    </div>
  );
});

CollaboratorButton.displayName = 'CollaboratorButton';
