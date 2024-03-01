import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { MoreHorizontal, UserPlus } from '@teable/icons';
import type { IGetSpaceVo } from '@teable/openapi';
import { createBase } from '@teable/openapi';
import type { ButtonProps } from '@teable/ui-lib';
import { Button } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { GUIDE_CREATE_BASE } from '@/components/Guide';
import { spaceConfig } from '@/features/i18n/space.config';
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
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

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
          className={GUIDE_CREATE_BASE}
          size={buttonSize}
          disabled={createBaseLoading}
          onClick={() => createBaseMutator({ spaceId: space.id })}
        >
          {t('space:action.createBase')}
        </Button>
      )}
      <SpaceCollaboratorModalTrigger space={space}>
        <Button variant={'outline'} size={buttonSize} disabled={createBaseLoading}>
          <UserPlus className="size-4" /> {t('space:action.invite')}
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
