import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from '@teable-group/icons';
import type { BaseSchema, SpaceSchema } from '@teable-group/openapi';
import { BaseApi, SpaceApi } from '@teable-group/sdk/api';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useState, type FC, useRef, useEffect } from 'react';
import { BaseCard } from './BaseCard';
import { SpaceActionTrigger } from './component/SpaceActionTrigger';

interface ISpaceCard {
  space: SpaceSchema.IGetSpaceVo;
  bases?: BaseSchema.IGetBaseVo[];
}
export const SpaceCard: FC<ISpaceCard> = (props) => {
  const { space, bases } = props;
  const queryClient = useQueryClient();
  const router = useRouter();
  const spaceId = router.query.spaceId as string;
  const [renaming, setRenaming] = useState<boolean>();
  const [spaceName, setSpaceName] = useState<string>(space.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const { mutate: createBase, isLoading: createBaseLoading } = useMutation({
    mutationFn: BaseApi.createBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: spaceId ? ['base-list', spaceId] : ['base-list'] });
    },
  });

  const { mutate: deleteSpace } = useMutation({
    mutationFn: SpaceApi.deleteSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-list'] });
    },
  });

  const { mutateAsync: updateSpace } = useMutation({
    mutationFn: SpaceApi.updateSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-list'] });
    },
  });

  useEffect(() => {
    if (renaming) {
      // console.log('inputRef.current', inputRef.current)
      setTimeout(() => {
        inputRef.current?.focus();
      }, 200);
      setSpaceName(space.name);
    }
  }, [renaming, space.name]);

  const toggleUpdateSpace = async (e: React.FocusEvent<HTMLInputElement, Element>) => {
    const name = e.target.value;
    if (!name || name === space.name) {
      setRenaming(false);
      return;
    }
    await updateSpace({
      spaceId: space.id,
      updateSpaceRo: { name },
    });

    setRenaming(false);
  };

  return (
    <Card className="w-full">
      <CardHeader className="pt-5">
        <div className="flex justify-between items-center gap-3">
          {renaming ? (
            <Input
              ref={inputRef}
              className="flex-1 h-7"
              value={spaceName}
              onChange={(e) => setSpaceName(e.target.value)}
              onBlur={(e) => toggleUpdateSpace(e)}
            />
          ) : (
            <CardTitle className="truncate" title={space.name}>
              {space.name}
            </CardTitle>
          )}
          <div className="flex shrink-0 items-center gap-3">
            <Button
              variant={'outline'}
              size={'xs'}
              disabled={createBaseLoading}
              onClick={() => createBase({ spaceId: space.id })}
            >
              Create Base
            </Button>
            <SpaceActionTrigger
              onDelete={() => deleteSpace(space.id)}
              onRename={() => setRenaming(true)}
            >
              <Button variant={'outline'} size={'xs'}>
                <MoreHorizontal />
              </Button>
            </SpaceActionTrigger>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {bases?.length ? (
          <div className="flex flex-wrap gap-4">
            {bases.map((base) => (
              <BaseCard key={base.id} className="min-w-[17rem] flex-1 h-24" base={base} />
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
