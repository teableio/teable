import { Building2 } from '@teable/icons';
import type { CollaboratorItem } from '@teable/openapi';
import { PrincipalType } from '@teable/openapi';
import { UserAvatar } from '@teable/sdk/components';

interface IPreviewCollaboratorsProps {
  collaborators: CollaboratorItem[];
  total: number;
}

export const PreviewCollaborators = ({ collaborators, total }: IPreviewCollaboratorsProps) => {
  const moreCount = total - collaborators.length;
  return (
    <div className="flex items-center -space-x-2">
      {collaborators.map((collaborator) => {
        switch (collaborator.type) {
          case PrincipalType.User:
            return (
              <UserAvatar
                key={collaborator.userId}
                name={collaborator.userName}
                avatar={collaborator.avatar}
                className="size-8 border-2 border-background dark:border-popover"
              />
            );
          case PrincipalType.Department:
            return (
              <div
                key={collaborator.departmentId}
                className="relative flex size-8 items-center justify-center rounded-full border-2 border-background bg-secondary"
              >
                <Building2 className="size-5" />
              </div>
            );
        }
      })}
      {moreCount > 0 && (
        <div className="relative flex size-8 items-center justify-center rounded-full border-2 border-background bg-blue-500 font-medium text-white">
          {moreCount > 99 ? '99+' : `+${moreCount}`}
        </div>
      )}
    </div>
  );
};
