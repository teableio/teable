import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getUniqName, hasPermission, Role } from '@teable/core';
import { Plus } from '@teable/icons';
import { useTheme } from '@teable/next-themes';
import {
  createBase,
  PinType,
  deleteSpace,
  getSpaceById,
  getSubscriptionSummary,
  permanentDeleteSpace,
  updateSpace,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useIsMobile } from '@teable/sdk/hooks';
import { cn, ScrollArea } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { SpaceInnerSettingModal, SettingTab } from '@overridable/SpaceInnerSettingModal';
import { LevelWithUpgrade } from '../../components/billing/LevelWithUpgrade';
import { Collaborators } from '../../components/collaborator-manage/space-inner/Collaborators';
import { SpaceActionBar } from '../../components/space/SpaceActionBar';
import { SpaceRenaming } from '../../components/space/SpaceRenaming';
import { useIsCloud } from '../../hooks/useIsCloud';
import { useSetting } from '../../hooks/useSetting';
import { useTemplateMonitor } from '../base/duplicate/useTemplateMonitor';
import { BaseList } from './BaseList';
import { StarButton } from './space-side-bar/StarButton';
import { useBaseList } from './useBaseList';

export const SpaceInnerPage: React.FC = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isCloud = useIsCloud();
  useTemplateMonitor();
  const ref = useRef<HTMLDivElement>(null);
  const spaceId = router.query.spaceId as string;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const isMobile = useIsMobile();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [renaming, setRenaming] = useState<boolean>(false);
  const [spaceName, setSpaceName] = useState<string>();
  const [settingModalOpen, setSettingModalOpen] = useState(false);

  const { data: space } = useQuery({
    queryKey: ReactQueryKeys.space(spaceId),
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1]).then((res) => res.data),
  });

  const bases = useBaseList();

  const { disallowSpaceInvitation } = useSetting();

  const basesInSpace = useMemo(() => {
    return bases?.filter((base) => base.spaceId === spaceId);
  }, [bases, spaceId]);

  const { data: subscriptionSummary } = useQuery({
    queryKey: ReactQueryKeys.subscriptionSummary(spaceId),
    queryFn: () => getSubscriptionSummary(spaceId).then((res) => res.data),
    enabled: isCloud,
  });

  const { mutate: deleteSpaceMutator } = useMutation({
    mutationFn: deleteSpace,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      router.push({
        pathname: '/space',
      });
    },
  });

  const { mutate: permanentDeleteSpaceMutator } = useMutation({
    mutationFn: permanentDeleteSpace,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      router.push({
        pathname: '/space',
      });
    },
  });

  const { mutateAsync: updateSpaceMutator } = useMutation({
    mutationFn: updateSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.space(spaceId) });
    },
  });

  const { mutate: createBaseMutator, isPending: createBaseLoading } = useMutation({
    mutationFn: createBase,
    onSuccess: ({ data }) => {
      router.push({
        pathname: '/base/[baseId]',
        query: { baseId: data.id },
      });
    },
  });

  const handleCreateBase = () => {
    const name = getUniqName(t('common:noun.base'), basesInSpace?.map((base) => base.name) || []);
    createBaseMutator({ spaceId, name });
  };

  const canCreateBase = space && hasPermission(space.role, 'base|create');

  useEffect(() => setSpaceName(space?.name), [renaming, space?.name]);

  const toggleUpdateSpace = async (e: React.FocusEvent<HTMLInputElement, Element>) => {
    if (space) {
      const name = e.target.value;
      if (!name || name === space.name) {
        setRenaming(false);
        return;
      }
      await updateSpaceMutator({
        spaceId: space.id,
        updateSpaceRo: { name },
      });
    }
    setRenaming(false);
  };

  const handleOpenUpgrade = useCallback(() => {
    if (space?.role === Role.Owner) {
      setSettingModalOpen(true);
    }
  }, [space?.role]);

  const renderSubscription = () => {
    if (space && isCloud) {
      return (
        <LevelWithUpgrade
          level={subscriptionSummary?.level}
          status={subscriptionSummary?.status}
          spaceId={space.id}
          withUpgrade={space.role === Role.Owner}
          organization={space.organization}
          onUpgradeClick={handleOpenUpgrade}
          appSumoTier={subscriptionSummary?.appSumoTier}
        />
      );
    }
    return null;
  };

  const renderOrganization = () => {
    if (!isCloud && space && space.organization) {
      return <div className="text-sm text-gray-500">{space.organization.name}</div>;
    }
    return null;
  };

  return (
    space && (
      <div ref={ref} className={cn('flex h-full min-w-0 flex-1 flex-col py-6 sm:min-w-[760px]')}>
        <div
          className={cn(
            'flex shrink-0 px-8 items-start sm:items-center justify-between gap-4  sm:pb-4'
          )}
        >
          {isMobile ? (
            <div className="flex min-w-0 flex-col items-start justify-start gap-2">
              <div className="flex items-center justify-start gap-2 text-left">
                <SpaceRenaming
                  spaceName={spaceName!}
                  isRenaming={renaming}
                  onChange={(e) => setSpaceName(e.target.value)}
                  onBlur={(e) => toggleUpdateSpace(e)}
                  className="h-8"
                >
                  <h1 className="truncate text-2xl font-semibold">{space.name}</h1>
                </SpaceRenaming>
              </div>
              {renderSubscription()}
              {renderOrganization()}
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <SpaceRenaming
                spaceName={spaceName!}
                isRenaming={renaming}
                onChange={(e) => setSpaceName(e.target.value)}
                onBlur={(e) => toggleUpdateSpace(e)}
                className="h-8"
              >
                <h1 className="truncate text-2xl font-semibold">{space.name}</h1>
              </SpaceRenaming>
              <StarButton className="opacity-100" id={space.id} type={PinType.Space} />
              {renderSubscription()}
              {renderOrganization()}
            </div>
          )}

          <SpaceActionBar
            space={space}
            buttonSize={'xs'}
            invQueryFilters={ReactQueryKeys.baseAll() as unknown as string[]}
            disallowSpaceInvitation={disallowSpaceInvitation}
            onDelete={() => deleteSpaceMutator(space.id)}
            onPermanentDelete={() => permanentDeleteSpaceMutator(space.id)}
            onRename={() => setRenaming(true)}
          />
        </div>

        <div className="flex min-h-0 flex-1 gap-8 px-4 pt-4 sm:px-8">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {basesInSpace?.length ? (
              <BaseList
                key={spaceId}
                baseIds={basesInSpace.map((base) => base.id)}
                spaceId={spaceId}
                showToolbar={true}
              />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
                <Image
                  src={
                    isDark
                      ? '/images/layout/empty-base-dark.png'
                      : '/images/layout/empty-base-light.png'
                  }
                  alt="No bases available"
                  width={240}
                  height={240}
                />
                <div className="flex flex-col items-center justify-center gap-2">
                  <p className="text-base font-semibold text-foreground">
                    {t('space:emptySpaceTitle')}
                  </p>
                  <p className="text-sm text-muted-foreground">{t('space:spaceIsEmpty')}</p>
                </div>
                {canCreateBase && (
                  <Button onClick={handleCreateBase} disabled={createBaseLoading}>
                    <Plus className="size-4" />
                    {t('space:action.createBase')}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="hidden w-[200px] min-w-[200px] flex-col sm:flex">
            <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-w-0">
              <div className="text-left">
                <Collaborators spaceId={spaceId} space={space} />
              </div>
            </ScrollArea>
          </div>
        </div>

        <SpaceInnerSettingModal
          open={settingModalOpen}
          setOpen={setSettingModalOpen}
          defaultTab={SettingTab.Plan}
        >
          <span className="hidden" />
        </SpaceInnerSettingModal>
      </div>
    )
  );
};
