import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from '@teable-group/icons';
import { createSpace, getSpaceList } from '@teable-group/openapi';
import { Spin } from '@teable-group/ui-lib/base';
import { Button } from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { type FC } from 'react';
import { SpaceItem } from './SpaceItem';

export const SpaceList: FC = () => {
  const router = useRouter();
  const spaceId = router.query.spaceId;

  const { data: spaceList } = useQuery({
    queryKey: ['space-list', spaceId],
    queryFn: getSpaceList,
  });

  const { mutate: addSpace, isLoading } = useMutation({
    mutationFn: createSpace,
    onSuccess: async (data) => {
      router.push({
        pathname: '/space/[spaceId]',
        query: {
          spaceId: data.data.id,
        },
      });
    },
  });

  return (
    <div className="pt-4 flex flex-col overflow-hidden gap-2">
      <div className="px-3">
        <Button
          variant={'outline'}
          size={'xs'}
          disabled={isLoading}
          className="w-full"
          onClick={() => addSpace({})}
        >
          {isLoading ? <Spin className="w-3 h-3" /> : <Plus />}
        </Button>
      </div>
      <div className="px-3 overflow-y-auto">
        <ul>
          {spaceList?.data.map((space) => (
            <li key={space.id}>
              <SpaceItem space={space} isActive={space.id === router.query.spaceId} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
