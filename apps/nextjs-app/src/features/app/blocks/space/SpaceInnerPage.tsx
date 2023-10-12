import { useQuery } from '@tanstack/react-query';
import { getSpaceById, getBaseList } from '@teable-group/openapi';
import { useRouter } from 'next/router';
import { useRef, type FC } from 'react';
import { SpaceCard } from './SpaceCard';

export const SpaceInnerPage: FC = () => {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const spaceId = router.query.spaceId as string;
  const { data: spaceData } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1]),
  });

  const { data: baseList } = useQuery({
    queryKey: ['base-list', spaceId],
    queryFn: ({ queryKey }) => getBaseList({ spaceId: queryKey[1] }),
  });

  const space = spaceData?.data;

  return (
    <div ref={ref} className="flex h-screen w-full flex-col py-8">
      <div className="flex items-center justify-between px-12">
        <h4>{space?.name}</h4>
      </div>
      <div className="flex-1 space-y-8 overflow-y-auto px-12 pt-8">
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
