import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import type { IGetSpaceVo } from '@teable/openapi';
import { CollaboratorType, getSpaceCollaboratorList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { Trans, useTranslation } from 'next-i18next';
import { CollaboratorAdd } from '../components/CollaboratorAdd';
import { Collaborators } from './Collaborators';
import { SpaceInvite } from './SpaceInvite';
import { SpaceInviteLink } from './SpaceInviteLink';

interface ISpaceCollaboratorModal {
  space: IGetSpaceVo;
}

export const SpaceCollaboratorModal: React.FC<ISpaceCollaboratorModal> = (props) => {
  const { space } = props;
  const { id: spaceId, role, organization } = space;
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();

  const { data: collaborators, isLoading } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId),
    queryFn: ({ queryKey }) => getSpaceCollaboratorList(queryKey[1]).then((res) => res.data),
  });

  if (!collaborators || isLoading) {
    return <div>{t('actions.loading')}</div>;
  }

  return (
    <div className="flex grow flex-col overflow-hidden">
      <div className="pb-2 text-sm text-muted-foreground">
        <Trans
          ns="common"
          i18nKey={'invite.dialog.desc'}
          count={collaborators.uniqTotal}
          components={{ b: <b /> }}
        />
      </div>
      <div className="flex grow flex-col space-y-8 overflow-hidden">
        <SpaceInvite spaceId={spaceId} role={role} />
        {hasPermission(role, 'space|invite_link') && (
          <SpaceInviteLink spaceId={spaceId} role={role} />
        )}
        {organization && (
          <CollaboratorAdd
            currentRole={role}
            resourceId={spaceId}
            resourceType={CollaboratorType.Space}
            onConfirm={() => {
              queryClient.invalidateQueries({
                queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId),
              });
            }}
          />
        )}
        <div className="flex grow flex-col overflow-hidden">
          <div className="mb-3 text-sm text-muted-foreground">{t('invite.dialog.spaceTitle')}</div>
          <Collaborators spaceId={spaceId} role={role} />
        </div>
      </div>
    </div>
  );
};
