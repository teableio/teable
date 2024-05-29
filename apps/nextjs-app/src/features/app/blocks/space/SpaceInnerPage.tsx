import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PinType, deleteSpace, getBaseAll, getSpaceById, updateSpace } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { Collaborators } from '../../components/collaborator-manage/space-inner/Collaborators';
import { SpaceActionBar } from '../../components/space/SpaceActionBar';
import { SpaceRenaming } from '../../components/space/SpaceRenaming';
import { DraggableBaseGrid } from './DraggableBaseGrid';
import { StarButton } from './space-side-bar/StarButton';

export const SpaceInnerPage: React.FC = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const spaceId = router.query.spaceId as string;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const [renaming, setRenaming] = useState<boolean>(false);
  const [spaceName, setSpaceName] = useState<string>();

  const { data: space } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1]).then(({ data }) => data),
  });

  const { data: bases } = useQuery({
    queryKey: ReactQueryKeys.baseAll(),
    queryFn: getBaseAll,
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
      queryClient.invalidateQueries({ queryKey: ['space'] });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
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

  return (
    space && (
      <div ref={ref} className="flex size-full min-w-[760px] px-12 pt-8">
        <div className="w-full flex-1 space-y-6">
          <div className="flex items-center gap-2 pb-6">
            <SpaceRenaming
              spaceName={spaceName!}
              isRenaming={renaming}
              onChange={(e) => setSpaceName(e.target.value)}
              onBlur={(e) => toggleUpdateSpace(e)}
            >
              <h1 className="text-2xl font-semibold">{space.name}</h1>
            </SpaceRenaming>
            <StarButton className="opacity-100" id={space.id} type={PinType.Space} />
          </div>

          {bases?.data?.length ? (
            <DraggableBaseGrid bases={bases?.data} />
          ) : (
            <div className="flex items-center justify-center">
              <h1>{t('space:spaceIsEmpty')}</h1>
            </div>
          )}
        </div>

        <div className="ml-16 w-72 min-w-60">
          <SpaceActionBar
            className="flex shrink-0 items-center justify-end gap-3 pb-8"
            space={space}
            buttonSize={'xs'}
            invQueryFilters={ReactQueryKeys.baseAll() as unknown as string[]}
            onDelete={() => deleteSpaceMutator(space.id)}
            onRename={() => setRenaming(true)}
          />
          <div className="text-left">
            <Collaborators spaceId={spaceId} />
          </div>
        </div>
      </div>
    )
  );
};
