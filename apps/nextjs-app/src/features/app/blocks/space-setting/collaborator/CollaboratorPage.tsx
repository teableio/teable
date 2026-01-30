import { useQuery } from '@tanstack/react-query';
import { UserPlus } from '@teable/icons';
import { getSpaceById, getSpaceCollaboratorList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsHydrated } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import { InviteSpacePopover } from '@/features/app/components/collaborator/space/InviteSpacePopover';
import { Collaborators } from '@/features/app/components/collaborator-manage/space/Collaborators';
import { SpaceSettingContainer } from '@/features/app/components/SpaceSettingContainer';
import { spaceConfig } from '@/features/i18n/space.config';

export const CollaboratorPage = () => {
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const spaceId = router.query.spaceId as string;

  const { data: space } = useQuery({
    queryKey: ReactQueryKeys.space(spaceId),
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1]).then((res) => res.data),
  });

  const { data: collaborators } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId, { includeBase: true }),
    queryFn: ({ queryKey }) =>
      getSpaceCollaboratorList(queryKey[1], { includeBase: true }).then((res) => res.data),
  });

  return (
    <SpaceSettingContainer
      title={t('space:spaceSetting.collaborators')}
      description={
        <Trans
          ns="common"
          i18nKey={'invite.dialog.desc'}
          count={collaborators?.uniqTotal}
          components={{ b: <b /> }}
        />
      }
      className="overflow-hidden"
    >
      {isHydrated && !!space && (
        <div className="size-full">
          <Collaborators
            spaceId={spaceId}
            role={space.role}
            collaboratorQuery={{ includeBase: true }}
          >
            <InviteSpacePopover space={space}>
              <Button size="sm">
                <UserPlus className="size-4" /> {t('space:action.invite')}
              </Button>
            </InviteSpacePopover>
          </Collaborators>
        </div>
      )}
    </SpaceSettingContainer>
  );
};
