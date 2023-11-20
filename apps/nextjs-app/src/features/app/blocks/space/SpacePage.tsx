import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSpace, getBaseAll, getSpaceList } from '@teable-group/openapi';
import { Spin } from '@teable-group/ui-lib/base';
import { Button } from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useRef, type FC } from 'react';
import { SpaceCard } from './SpaceCard';

export const SpacePage: FC = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  const { data: spaceList } = useQuery({
    queryKey: ['space-list'],
    queryFn: getSpaceList,
  });
  const { data: baseList } = useQuery({
    queryKey: ['base-all'],
    queryFn: () => getBaseAll(),
  });

  const { mutate: createSpaceMutator, isLoading } = useMutation({
    mutationFn: createSpace,
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['space-list'] });
      router.push({
        pathname: '/space/[spaceId]',
        query: {
          spaceId: data.data.id,
        },
      });
    },
  });

  return (
    <div ref={ref} className="flex h-screen w-full flex-col py-8">
      <div className="flex items-center justify-between px-12">
        <h1 className="text-2xl font-semibold">All Spaces</h1>
        <Button size={'sm'} disabled={isLoading} onClick={() => createSpaceMutator({})}>
          {isLoading && <Spin className="h-3 w-3" />}Create a space
        </Button>
      </div>
      <div className="flex-1 space-y-8 overflow-y-auto px-8 pt-8 sm:px-12">
        {spaceList?.data.map((space) => (
          <SpaceCard
            key={space.id}
            space={space}
            bases={baseList?.data.filter(({ spaceId }) => spaceId === space.id)}
          />
        ))}
      </div>
    </div>
  );
};
