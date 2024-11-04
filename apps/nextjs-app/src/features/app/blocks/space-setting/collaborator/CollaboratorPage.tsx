import { useQuery } from '@tanstack/react-query';
import { UserPlus } from '@teable/icons';
import { getSpaceById } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsHydrated } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { Collaborators } from '@/features/app/components/collaborator-manage/space/Collaborators';
import { SpaceCollaboratorModalTrigger } from '@/features/app/components/collaborator-manage/space/SpaceCollaboratorModalTrigger';
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

  return (
    <SpaceSettingContainer
      title={t('space:spaceSetting.collaborators')}
      description={t('space:spaceSetting.collaboratorDescription')}
    >
      {isHydrated && !!space && (
        <div className="w-full py-4">
          <Collaborators
            spaceId={spaceId}
            role={space.role}
            collaboratorQuery={{ includeBase: true }}
          >
            <SpaceCollaboratorModalTrigger space={space}>
              <Button size="sm">
                <UserPlus className="size-4" /> {t('space:action.invite')}
              </Button>
            </SpaceCollaboratorModalTrigger>
          </Collaborators>
        </div>
      )}
    </SpaceSettingContainer>
  );
};
