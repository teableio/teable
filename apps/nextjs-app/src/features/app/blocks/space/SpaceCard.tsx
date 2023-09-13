import { useMutation } from '@tanstack/react-query';
import { MoreHorizontal } from '@teable-group/icons';
import type { BaseSchema, SpaceSchema } from '@teable-group/openapi';
import { BaseApi } from '@teable-group/sdk/api';
import { Spin } from '@teable-group/ui-lib/base';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useRef, type FC } from 'react';
import { BaseCard } from './BaseCard';

interface ISpaceCard {
  space: SpaceSchema.IGetSpaceVo;
  bases?: BaseSchema.IGetBaseVo[];
}
export const SpaceCard: FC<ISpaceCard> = (props) => {
  const { space, bases } = props;
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { mutate: createBase, isLoading } = useMutation({
    mutationFn: BaseApi.createBase,
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
    <Card ref={ref} className="w-full">
      <CardHeader className="pt-5">
        <div className="flex justify-between items-center">
          <CardTitle>{space.name}</CardTitle>
          <div className="space-x-3">
            <Button
              variant={'outline'}
              size={'xs'}
              disabled={isLoading}
              onClick={() => createBase({ spaceId: space.id })}
            >
              {isLoading && <Spin className="w-3 h-3" />}Create Base
            </Button>
            <Button variant={'outline'} size={'xs'}>
              <MoreHorizontal />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {bases?.length ? (
          <div className="flex flex-wrap gap-4">
            {bases.map((base) => (
              <BaseCard key={base.id} className="min-w-[16rem] flex-1 h-24" base={base} />
            ))}
          </div>
        ) : (
          <div className="w-full h-24 flex items-center justify-center">
            This workspace is empty
          </div>
        )}
      </CardContent>
    </Card>
  );
};
