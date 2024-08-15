import type { IRole } from '@teable/core';
import { Role } from '@teable/core';
import { useMemo } from 'react';
import { useTranslation } from '../context/app/i18n';

export interface ISpaceRoleStatic {
  role: IRole;
  name: string;
  description: string;
  level: number;
}

export const useSpaceRoleStatic = (): ISpaceRoleStatic[] => {
  const { t } = useTranslation();
  return useMemo(() => {
    return [
      {
        role: Role.Creator,
        name: t('spaceRole.role.creator'),
        description: t('spaceRole.description.creator'),
        level: 1,
      },
      {
        role: Role.Editor,
        name: t('spaceRole.role.editor'),
        description: t('spaceRole.description.editor'),
        level: 2,
      },
      {
        role: Role.Commenter,
        name: t('spaceRole.role.commenter'),
        description: t('spaceRole.description.commenter'),
        level: 3,
      },
      {
        role: Role.Viewer,
        name: t('spaceRole.role.viewer'),
        description: t('spaceRole.description.viewer'),
        level: 4,
      },
      {
        role: Role.Owner,
        name: t('spaceRole.role.owner'),
        description: t('spaceRole.description.owner'),
        level: 0,
      },
    ];
  }, [t]);
};
