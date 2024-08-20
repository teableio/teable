import { Role } from '@teable/core';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import type { IRoleStatic } from './types';

export const useRoleStatic = (): IRoleStatic[] => {
  const { t } = useTranslation('common');
  return useMemo(() => {
    return [
      {
        role: Role.Creator,
        name: t('role.title.creator'),
        description: t('role.description.creator'),
        level: 1,
      },
      {
        role: Role.Editor,
        name: t('role.title.editor'),
        description: t('role.description.editor'),
        level: 2,
      },
      {
        role: Role.Commenter,
        name: t('role.title.commenter'),
        description: t('role.description.commenter'),
        level: 3,
      },
      {
        role: Role.Viewer,
        name: t('role.title.viewer'),
        description: t('role.description.viewer'),
        level: 4,
      },
      {
        role: Role.Owner,
        name: t('role.title.owner'),
        description: t('role.description.owner'),
        level: 0,
      },
    ];
  }, [t]);
};
