import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IGetBaseVo, IGetSpaceVo } from '@teable-group/openapi';
import { deleteSpace, updateSpace } from '@teable-group/openapi';
import { Card, CardContent, CardHeader, CardTitle } from '@teable-group/ui-lib/shadcn';
import { type FC, useEffect, useState } from 'react';
import { SpaceActionBar } from '../../components/space/SpaceActionBar';
import { SpaceRenaming } from '../../components/space/SpaceRenaming';
import { BaseCard } from './BaseCard';

interface ISpaceCard {
  space: IGetSpaceVo;
  bases?: IGetBaseVo[];
}
export const SpaceCard: FC<ISpaceCard> = (props) => {
  const { space, bases } = props;
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<boolean>(false);
  const [spaceName, setSpaceName] = useState<string>(space.name);

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

  useEffect(() => setSpaceName(space?.name), [renaming, space?.name]);

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
          <SpaceRenaming
            spaceName={spaceName!}
            isRenaming={renaming}
            onChange={(e) => setSpaceName(e.target.value)}
            onBlur={(e) => toggleUpdateSpace(e)}
          >
            <CardTitle className="truncate" title={space.name}>
              {space.name}
            </CardTitle>
          </SpaceRenaming>
          <SpaceActionBar
            className="flex shrink-0 items-center gap-3"
            buttonSize="xs"
            space={space}
            invQueryFilters={['base-all']}
            onDelete={() => deleteSpaceMutator(space.id)}
            onRename={() => setRenaming(true)}
          />
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
          <div className="flex h-24 w-full items-center justify-center">This space is empty</div>
        )}
      </CardContent>
    </Card>
  );
};
