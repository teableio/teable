import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable-group/core';
import { MoreHorizontal, UserPlus } from '@teable-group/icons';
import type { IGetSpaceVo } from '@teable-group/openapi';
import { createBase } from '@teable-group/openapi';
import type { ButtonProps } from '@teable-group/ui-lib';
import { Button } from '@teable-group/ui-lib';
import React from 'react';
import { SpaceActionTrigger } from '../../blocks/space/component/SpaceActionTrigger';
import { SpaceCollaboratorModalTrigger } from '../collaborator-manage/space/SpaceCollaboratorModalTrigger';

interface ActionBarProps {
  space: IGetSpaceVo;
  invQueryFilters: string[];
  className?: string;
  buttonSize?: ButtonProps['size'];
  onRename?: () => void;
  onDelete?: () => void;
}

export const SpaceActionBar: React.FC<ActionBarProps> = (props) => {
  const { space, invQueryFilters, className, buttonSize = 'default', onRename, onDelete } = props;
  const queryClient = useQueryClient();

  const { mutate: createBaseMutator, isLoading: createBaseLoading } = useMutation({
    mutationFn: createBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invQueryFilters });
    },
  });
  return (
    <div className={className}>
      {hasPermission(space.role, 'base|create') && (
        <Button
          size={buttonSize}
          disabled={createBaseLoading}
          onClick={() => createBaseMutator({ spaceId: space.id })}
        >
          Create Base
        </Button>
      )}
      <SpaceCollaboratorModalTrigger space={space}>
        <Button variant={'outline'} size={buttonSize} disabled={createBaseLoading}>
          <UserPlus className="h-4 w-4" /> Invite
        </Button>
      </SpaceCollaboratorModalTrigger>
      <SpaceActionTrigger
        space={space}
        showRename={hasPermission(space.role, 'space|update')}
        showDelete={hasPermission(space.role, 'space|delete')}
        onDelete={onDelete}
        onRename={onRename}
      >
        <Button variant={'outline'} size={buttonSize}>
          <MoreHorizontal />
        </Button>
      </SpaceActionTrigger>
    </div>
  );
};
