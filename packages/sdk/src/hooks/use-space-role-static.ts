import { SpaceRole } from '@teable/core';
import { useMemo } from 'react';
import { useTranslation } from '../context/app/i18n';

export interface ISpaceRoleStatic {
  role: SpaceRole;
  name: string;
  description: string;
  level: number;
}

export const useSpaceRoleStatic = (): ISpaceRoleStatic[] => {
  const { t } = useTranslation();
  return useMemo(() => {
    return [
      {
        role: SpaceRole.Creator,
        name: t('spaceRole.role.creator'),
        description: t('spaceRole.description.creator'),
        level: 1,
      },
      {
        role: SpaceRole.Editor,
        name: t('spaceRole.role.editor'),
        description: t('spaceRole.description.editor'),
        level: 2,
      },
      {
        role: SpaceRole.Commenter,
        name: t('spaceRole.role.commenter'),
        description: t('spaceRole.description.commenter'),
        level: 3,
      },
      {
        role: SpaceRole.Viewer,
        name: t('spaceRole.role.viewer'),
        description: t('spaceRole.description.viewer'),
        level: 4,
      },
      {
        role: SpaceRole.Owner,
        name: t('spaceRole.role.owner'),
        description: t('spaceRole.description.owner'),
        level: 0,
      },
    ];
  }, [t]);
};
