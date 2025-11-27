import { ChevronRight } from '@teable/icons';
import type { CollaboratorItem } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { forwardRef } from 'react';
import { PreviewCollaborators } from './PreviewCollaborators';

export const CollaboratorButton = forwardRef<
  HTMLDivElement,
  {
    className?: string;
    collaborators: CollaboratorItem[];
    onClick: () => void;
    total: number;
  }
>(({ className, collaborators, total, onClick }, ref) => {
  const { t } = useTranslation('common');
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={ref}
      onClick={onClick}
      className={cn(
        'inline-flex h-12 w-full cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-md p-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <PreviewCollaborators collaborators={collaborators || []} total={total} />
        <p>{t('invite.dialog.haveAccess')}</p>
      </div>
      <ChevronRight className="size-4 text-muted-foreground" />
    </div>
  );
});

CollaboratorButton.displayName = 'CollaboratorButton';
