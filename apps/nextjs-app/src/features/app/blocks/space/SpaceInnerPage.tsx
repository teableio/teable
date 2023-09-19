import { useQuery } from '@tanstack/react-query';
import { BaseApi, SpaceApi } from '@teable-group/sdk/api';
import { useRouter } from 'next/router';
import { useRef, type FC } from 'react';
import { SpaceCard } from './SpaceCard';

export const SpaceInnerPage: FC = () => {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const spaceId = router.query.spaceId as string;
  const { data: spaceData } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: ({ queryKey }) => SpaceApi.getSpaceById(queryKey[1]),
  });

  const { data: baseList } = useQuery({
    queryKey: ['base-list', spaceId],
    queryFn: ({ queryKey }) => BaseApi.getBaseList({ spaceId: queryKey[1] }),
  });

  const space = spaceData?.data;

  return (
    <div ref={ref} className="w-full h-screen flex flex-col py-8">
      <div className="flex px-12 justify-between items-center">
        <h4>{space?.name}</h4>
      </div>
      <div className="flex-1 px-12 pt-8 space-y-8 overflow-y-auto">
        {space && (
          <SpaceCard
            key={space.id}
            space={space}
            bases={baseList?.data.filter(({ spaceId }) => spaceId === space.id)}
          />
        )}
      </div>
    </div>
  );
};
