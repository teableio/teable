import { Building2 } from '@teable/icons';
import type { CollaboratorItem } from '@teable/openapi';
import { PrincipalType } from '@teable/openapi';
import { cn, Button } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { UserAvatar } from '../user/UserAvatar';

interface CollaboratorAvatarsProps {
  collaborators: CollaboratorItem[];
  maxDisplay?: number;
  onShowMore?: () => void;
  className?: string;
}

export const CollaboratorAvatars: React.FC<CollaboratorAvatarsProps> = ({
  collaborators,
  maxDisplay = 15,
  onShowMore,
  className,
}) => {
  const { t } = useTranslation('space');

  const { displayedCollaborators, remainingCount } = useMemo(() => {
    const displayed = collaborators.slice(0, maxDisplay);
    const remaining = Math.max(0, collaborators.length - maxDisplay);
    return {
      displayedCollaborators: displayed,
      remainingCount: remaining,
    };
  }, [collaborators, maxDisplay]);

  if (collaborators.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex items-center', className)}>
      <div className="flex items-center space-x-1">
        <span className="text-sm text-muted-foreground">{t('collaborators')}:</span>
        <div className="flex -space-x-1">
          {displayedCollaborators.map((collaborator, index) => {
            const getUserId = (collab: typeof collaborator) => {
              return collab.type === PrincipalType.User ? collab.userId : collab.departmentId;
            };

            const getUserName = (collab: typeof collaborator) => {
              return collab.type === PrincipalType.User ? collab.userName : collab.departmentName;
            };

            const getUserAvatar = (collab: typeof collaborator) => {
              return collab.type === PrincipalType.User ? collab.avatar : null;
            };

            return (
              <div
                key={getUserId(collaborator)}
                className="relative"
                style={{ zIndex: displayedCollaborators.length - index }}
              >
                {collaborator.type === PrincipalType.User ? (
                  <UserAvatar
                    user={{ name: getUserName(collaborator), avatar: getUserAvatar(collaborator) }}
                    className="size-6 border-2 border-background"
                  />
                ) : (
                  <div className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-accent">
                    <Building2 className="size-3" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {remainingCount > 0 && onShowMore && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={onShowMore}
          >
            +{remainingCount} {t('more')}
          </Button>
        )}
      </div>
    </div>
  );
};
