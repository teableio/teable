import { useQuery } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { hasPermission } from '@teable/core';
import { getBaseCollaboratorList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { Trans, useTranslation } from 'next-i18next';
import { BaseCollaborators } from './BaseCollaborators';
import { BaseInvite } from './BaseInvite';
import { BaseInviteLink } from './BaseInviteLink';

export const BaseCollaboratorContent = (props: { baseId: string; role: IRole }) => {
  const { baseId, role } = props;
  const { t } = useTranslation('common');

  const { data: collaborators } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId, { includeSystem: true }),
    queryFn: ({ queryKey }) =>
      getBaseCollaboratorList(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  if (!collaborators?.length) {
    return <div>{t('actions.loading')}</div>;
  }

  return (
    <div className="overflow-y-auto">
      <div className="pb-2 text-sm text-muted-foreground">
        <Trans
          ns="common"
          i18nKey={'invite.base.desc'}
          count={collaborators.length}
          components={{ b: <b /> }}
        />
      </div>
      <div className="space-y-8">
        <BaseInvite baseId={baseId} role={role} />
        {hasPermission(role, 'base|invite_link') && <BaseInviteLink baseId={baseId} role={role} />}
        <div className="w-full">
          <div className="mb-3 text-sm text-muted-foreground">{t('invite.dialog.spaceTitle')}</div>
          <BaseCollaborators baseId={baseId} role={role} />
        </div>
      </div>
    </div>
  );
};
