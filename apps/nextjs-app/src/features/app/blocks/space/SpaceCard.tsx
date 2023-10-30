import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from '@teable-group/icons';
import type { IGetSpaceVo, IGetBaseVo } from '@teable-group/openapi';
import { createBase, deleteSpace, updateSpace } from '@teable-group/openapi';
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
import { SpaceCollaboratorModalTrigger } from '../../components/collaborator-manage/space/SpaceCollaboratorModalTrigger';
import { BaseCard } from './BaseCard';
import { SpaceActionTrigger } from './component/SpaceActionTrigger';

interface ISpaceCard {
  space: IGetSpaceVo;
  bases?: IGetBaseVo[];
}
export const SpaceCard: FC<ISpaceCard> = (props) => {
  const { space, bases } = props;
  const queryClient = useQueryClient();
  const router = useRouter();
  const spaceId = router.query.spaceId as string;
  const [renaming, setRenaming] = useState<boolean>();
  const [spaceName, setSpaceName] = useState<string>(space.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const { mutate: createBaseMutator, isLoading: createBaseLoading } = useMutation({
    mutationFn: createBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: spaceId ? ['base-list', spaceId] : ['base-list'] });
    },
  });

  const { mutate: deleteSpaceMutator } = useMutation({
    mutationFn: deleteSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-list'] });
    },
  });

  const { mutateAsync: updateSpaceMutator } = useMutation({
    mutationFn: updateSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-list'] });
      queryClient.invalidateQueries({ queryKey: ['space'] });
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
    await updateSpaceMutator({
      spaceId: space.id,
      updateSpaceRo: { name },
    });

    setRenaming(false);
  };

  return (
    <Card className="w-full">
      <CardHeader className="pt-5">
        <div className="flex items-center justify-between gap-3">
          {renaming ? (
            <Input
              ref={inputRef}
              className="h-7 flex-1"
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
              size={'xs'}
              disabled={createBaseLoading}
              onClick={() => createBaseMutator({ spaceId: space.id })}
            >
              Create Base
            </Button>
            <SpaceCollaboratorModalTrigger space={space}>
              <Button variant={'outline'} size={'xs'} disabled={createBaseLoading}>
                Share
              </Button>
            </SpaceCollaboratorModalTrigger>
            <SpaceActionTrigger
              onDelete={() => deleteSpaceMutator(space.id)}
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
            {bases.map((base) => (
              <BaseCard
                key={base.id}
                className="h-24 min-w-[17rem] max-w-[34rem] flex-1"
                base={base}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-24 w-full items-center justify-center">
            This workspace is empty
          </div>
        )}
      </CardContent>
    </Card>
  );
};
