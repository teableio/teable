import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Role } from '@teable/core';
import type { IGetBaseVo, IGetSpaceVo, ISubscriptionSummaryVo } from '@teable/openapi';
import { PinType, deleteSpace, updateSpace } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Card, CardContent, CardHeader, CardTitle } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { type FC, useEffect, useState } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { LevelWithUpgrade } from '../../components/billing/LevelWithUpgrade';
import { SpaceActionBar } from '../../components/space/SpaceActionBar';
import { SpaceRenaming } from '../../components/space/SpaceRenaming';
import { useIsCloud } from '../../hooks/useIsCloud';
import { DraggableBaseGrid } from './DraggableBaseGrid';
import { StarButton } from './space-side-bar/StarButton';

interface ISpaceCard {
  space: IGetSpaceVo;
  bases?: IGetBaseVo[];
  subscription?: ISubscriptionSummaryVo;
  disallowSpaceInvitation?: boolean | null;
}
export const SpaceCard: FC<ISpaceCard> = (props) => {
  const { space, bases, subscription, disallowSpaceInvitation } = props;
  const router = useRouter();
  const isCloud = useIsCloud();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<boolean>(false);
  const [spaceName, setSpaceName] = useState<string>(space.name);
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const { mutate: deleteSpaceMutator } = useMutation({
    mutationFn: deleteSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
    },
  });

  const { mutateAsync: updateSpaceMutator } = useMutation({
    mutationFn: updateSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.space(space.id) });
    },
  });

  useEffect(() => setSpaceName(space?.name), [renaming, space?.name]);

  const toggleUpdateSpace = async (e: React.FocusEvent<HTMLInputElement, Element>) => {
    const name = e.target.value;
    if (!name || name === space.name) {
      setRenaming(false);
      return;
    }
    await updateSpaceMutator({
      spaceId: space.id,
      updateSpaceRo: { name },
    });

    setRenaming(false);
  };

  const onSpaceSetting = () => {
    router.push({
      pathname: '/space/[spaceId]/setting/general',
      query: { spaceId: space.id },
    });
  };

  return (
    <Card className="w-full">
      <CardHeader className="pt-5">
        <div className="flex w-full items-center justify-between gap-3">
          <div className="group flex flex-1 items-center gap-2 overflow-hidden">
            <SpaceRenaming
              spaceName={spaceName!}
              isRenaming={renaming}
              onChange={(e) => setSpaceName(e.target.value)}
              onBlur={(e) => toggleUpdateSpace(e)}
            >
              <CardTitle className="truncate leading-5" title={space.name}>
                {space.name}
              </CardTitle>
            </SpaceRenaming>
            <StarButton className="opacity-100" id={space.id} type={PinType.Space} />
            {isCloud && (
              <LevelWithUpgrade
                level={subscription?.level}
                status={subscription?.status}
                spaceId={space.id}
                withUpgrade={space.role === Role.Owner}
                organization={space?.organization}
              />
            )}
            {!isCloud && space?.organization && (
              <div className="text-sm text-gray-500">{space.organization.name}</div>
            )}
          </div>
          <SpaceActionBar
            className="flex shrink-0 items-center gap-3"
            buttonSize="xs"
            space={space}
            invQueryFilters={ReactQueryKeys.baseAll() as unknown as string[]}
            disallowSpaceInvitation={disallowSpaceInvitation}
            onDelete={() => deleteSpaceMutator(space.id)}
            onRename={() => setRenaming(true)}
            onSpaceSetting={onSpaceSetting}
          />
        </div>
      </CardHeader>
      <CardContent>
        {bases?.length ? (
          <DraggableBaseGrid bases={bases} />
        ) : (
          <div className="flex h-24 w-full items-center justify-center">
            {t('space:spaceIsEmpty')}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
