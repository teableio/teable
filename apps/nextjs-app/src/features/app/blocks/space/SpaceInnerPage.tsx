import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteSpace, getBaseList, getSpaceById, updateSpace } from '@teable-group/openapi';
import { useRouter } from 'next/router';
import { type FC, useEffect, useRef, useState } from 'react';
import { SpaceRenaming } from '@/features/app/components/space/SpaceRenaming';
import { Collaborators } from '../../components/collaborator-manage/space-inner/Collaborators';
import { SpaceActionBar } from '../../components/space/SpaceActionBar';
import { BaseCard } from './BaseCard';

export const SpaceInnerPage: FC = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const spaceId = router.query.spaceId as string;

  const [renaming, setRenaming] = useState<boolean>(false);
  const [spaceName, setSpaceName] = useState<string>();

  const { data: spaceData } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1]),
  });

  const { data: baseList } = useQuery({
    queryKey: ['base-list', spaceId],
    queryFn: ({ queryKey }) => getBaseList({ spaceId: queryKey[1] }),
  });

  const { mutate: deleteSpaceMutator } = useMutation({
    mutationFn: deleteSpace,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['space-list'] });
      router.push({
        pathname: '/space',
      });
    },
  });

  const { mutateAsync: updateSpaceMutator } = useMutation({
    mutationFn: updateSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space'] });
      queryClient.invalidateQueries({ queryKey: ['space-list'] });
    },
  });

  const space = spaceData?.data;
  const bases = baseList?.data;

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
      <div ref={ref} className="flex h-full w-full min-w-[760px] px-12 pt-8">
        <div className="w-full flex-1 space-y-6">
          <div className="pb-6">
            <SpaceRenaming
              spaceName={spaceName!}
              isRenaming={renaming}
              onChange={(e) => setSpaceName(e.target.value)}
              onBlur={(e) => toggleUpdateSpace(e)}
            >
              <h1 className="text-2xl font-semibold">{space.name}</h1>
            </SpaceRenaming>
          </div>

          {bases?.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
              {bases.map((base) => (
                <BaseCard
                  key={base.id}
                  className="h-24 min-w-[17rem] max-w-[34rem] flex-1"
                  base={base}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <h1>This workspace is empty</h1>
            </div>
          )}
        </div>

        <div className="ml-16 w-64 min-w-[16rem]">
          <SpaceActionBar
            className="flex items-center justify-between pb-8 text-right"
            space={space}
            invQueryFilters={['base-list', spaceId]}
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
