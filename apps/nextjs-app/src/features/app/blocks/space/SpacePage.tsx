import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BaseApi, SpaceApi } from '@teable-group/sdk/api';
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
    queryFn: SpaceApi.getSpaceList,
  });
  const { data: baseList } = useQuery({
    queryKey: ['base-list'],
    queryFn: () => BaseApi.getBaseList(),
  });

  const { mutate: createSpace, isLoading } = useMutation({
    mutationFn: SpaceApi.createSpace,
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
    <div ref={ref} className="w-full h-screen flex flex-col py-8">
      <div className="flex px-12 justify-between items-center">
        <h4>All Workspaces</h4>
        <Button size={'sm'} disabled={isLoading} onClick={() => createSpace({})}>
          {isLoading && <Spin className="w-3 h-3" />}Create a workspace
        </Button>
      </div>
      <div className="flex-1 px-12 pt-8 space-y-8 overflow-y-auto">
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
