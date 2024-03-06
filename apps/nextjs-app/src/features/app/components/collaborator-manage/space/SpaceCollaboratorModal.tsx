import { useQuery } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import type { IGetSpaceVo } from '@teable/openapi';
import { getSpaceCollaboratorList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { Trans, useTranslation } from 'next-i18next';
import { Collaborators } from './Collaborators';
import { Invite } from './Invite';
import { InviteLink } from './InviteLink';

interface ISpaceCollaboratorModal {
  space: IGetSpaceVo;
}

export const SpaceCollaboratorModal: React.FC<ISpaceCollaboratorModal> = (props) => {
  const { space } = props;
  const { id: spaceId, role } = space;
  const { t } = useTranslation('common');

  const { data: collaborators } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId),
    queryFn: ({ queryKey }) => getSpaceCollaboratorList(queryKey[1]).then(({ data }) => data),
  });

  if (!collaborators?.length) {
    return <div>{t('actions.loading')}</div>;
  }

  return (
    <div className="overflow-y-auto">
      <div className="pb-2 text-sm text-muted-foreground">
        <Trans
          ns="common"
          i18nKey={'invite.dialog.desc'}
          count={collaborators.length}
          components={{ b: <b /> }}
        />
      </div>
      <div className="space-y-8">
        <Invite spaceId={spaceId} role={role} />
        {hasPermission(role, 'space|invite_link') && <InviteLink spaceId={spaceId} role={role} />}
        <Collaborators spaceId={spaceId} role={role} />
      </div>
    </div>
  );
};
