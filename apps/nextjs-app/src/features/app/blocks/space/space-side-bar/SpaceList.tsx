import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from '@teable/icons';
import { createSpace, getSpaceList } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
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
    <div className="flex flex-col gap-2 overflow-hidden pt-4">
      <div className="px-3">
        <Button
          variant={'outline'}
          size={'xs'}
          disabled={isLoading}
          className="w-full"
          onClick={() => addSpace({})}
        >
          {isLoading ? <Spin className="size-3" /> : <Plus />}
        </Button>
      </div>
      <div className="overflow-y-auto px-3">
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
