import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Role } from '@teable/core';
import {
  PinType,
  deleteSpace,
  getSpaceById,
  getSubscriptionSummary,
  updateSpace,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ScrollArea } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { LevelWithUpgrade } from '../../components/billing/LevelWithUpgrade';
import { Collaborators } from '../../components/collaborator-manage/space-inner/Collaborators';
import { SpaceActionBar } from '../../components/space/SpaceActionBar';
import { SpaceRenaming } from '../../components/space/SpaceRenaming';
import { useIsCloud } from '../../hooks/useIsCloud';
import { useSetting } from '../../hooks/useSetting';
import { DraggableBaseGrid } from './DraggableBaseGrid';
import { StarButton } from './space-side-bar/StarButton';
import { useBaseList } from './useBaseList';

export const SpaceInnerPage: React.FC = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isCloud = useIsCloud();
  const ref = useRef<HTMLDivElement>(null);
  const spaceId = router.query.spaceId as string;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const [renaming, setRenaming] = useState<boolean>(false);
  const [spaceName, setSpaceName] = useState<string>();

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

  const { mutateAsync: updateSpaceMutator } = useMutation({
    mutationFn: updateSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.space(spaceId) });
    },
  });

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

  const onSpaceSetting = () => {
    router.push({
      pathname: '/space/[spaceId]/setting/general',
      query: { spaceId },
    });
  };

  return (
    space && (
      <div ref={ref} className="min-w-auto flex size-full px-12 py-8 sm:min-w-[760px]">
        <div className="flex w-full flex-1 flex-col space-y-6">
          <div className="flex items-center gap-2 pb-6 sm:mr-16">
            <SpaceRenaming
              spaceName={spaceName!}
              isRenaming={renaming}
              onChange={(e) => setSpaceName(e.target.value)}
              onBlur={(e) => toggleUpdateSpace(e)}
            >
              <h1 className="text-2xl font-semibold">{space.name}</h1>
            </SpaceRenaming>
            <StarButton className="opacity-100" id={space.id} type={PinType.Space} />
            {isCloud && (
              <LevelWithUpgrade
                level={subscriptionSummary?.level}
                status={subscriptionSummary?.status}
                spaceId={space.id}
                withUpgrade={space.role === Role.Owner}
                organization={space.organization}
              />
            )}
            {!isCloud && space.organization && (
              <div className="text-sm text-gray-500">{space.organization.name}</div>
            )}
          </div>
          <SpaceActionBar
            className="flex shrink-0 items-center justify-end gap-3 sm:hidden"
            space={space}
            buttonSize={'xs'}
            invQueryFilters={ReactQueryKeys.baseAll() as unknown as string[]}
            disallowSpaceInvitation={disallowSpaceInvitation}
            onDelete={() => deleteSpaceMutator(space.id)}
            onRename={() => setRenaming(true)}
            onSpaceSetting={onSpaceSetting}
          />
          {basesInSpace?.length ? (
            <ScrollArea className="sm:mr-8 sm:pb-2">
              <DraggableBaseGrid bases={basesInSpace} className="pb-8 sm:pr-8" />
            </ScrollArea>
          ) : (
            <div className="flex items-center justify-center">
              <h1>{t('space:spaceIsEmpty')}</h1>
            </div>
          )}
        </div>

        <div className="hidden w-72 min-w-60 flex-col sm:flex">
          <SpaceActionBar
            className="flex shrink-0 items-center justify-end gap-3 pb-8"
            space={space}
            buttonSize={'xs'}
            invQueryFilters={ReactQueryKeys.baseAll() as unknown as string[]}
            disallowSpaceInvitation={disallowSpaceInvitation}
            onDelete={() => deleteSpaceMutator(space.id)}
            onRename={() => setRenaming(true)}
            onSpaceSetting={onSpaceSetting}
          />
          <ScrollArea className="flex-1">
            <div className="text-left">
              <Collaborators spaceId={spaceId} space={space} />
            </div>
          </ScrollArea>
        </div>
      </div>
    )
  );
};
