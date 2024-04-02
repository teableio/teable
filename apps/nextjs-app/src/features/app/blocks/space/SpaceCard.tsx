import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IGetBaseVo, IGetSpaceVo } from '@teable/openapi';
import { deleteSpace, updateSpace } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Card, CardContent, CardHeader, CardTitle } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { type FC, useEffect, useState } from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { SpaceActionBar } from '../../components/space/SpaceActionBar';
import { SpaceRenaming } from '../../components/space/SpaceRenaming';
import { DraggableBaseGrid } from './DraggableBaseGrid';

interface ISpaceCard {
  space: IGetSpaceVo;
  bases?: IGetBaseVo[];
}
export const SpaceCard: FC<ISpaceCard> = (props) => {
  const { space, bases } = props;
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<boolean>(false);
  const [spaceName, setSpaceName] = useState<string>(space.name);
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const { mutate: deleteSpaceMutator } = useMutation({
    mutationFn: deleteSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
    },
  });

  const { mutateAsync: updateSpaceMutator } = useMutation({
    mutationFn: updateSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
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
          <DraggableBaseGrid bases={bases} />
        ) : (
          <div className="flex h-24 w-full items-center justify-center">
            {t('space:spaceIsEmpty')}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
