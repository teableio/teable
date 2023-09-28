import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Database, MoreHorizontal } from '@teable-group/icons';
import type { IGetBaseVo } from '@teable-group/openapi';
import { deleteBase, updateBase } from '@teable-group/openapi';
import { Button, Card, CardContent, Input } from '@teable-group/ui-lib/shadcn';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import { useState, type FC, useRef } from 'react';
import { BaseActionTrigger } from './component/BaseActionTrigger';

interface IBaseCard {
  base: IGetBaseVo;
  className?: string;
}

export const BaseCard: FC<IBaseCard> = (props) => {
  const { base, className } = props;
  const router = useRouter();
  const queryClient = useQueryClient();
  const routerSpaceId = router.query.spaceId;
  const [renaming, setRenaming] = useState<boolean>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [baseName, setBaseName] = useState<string>(base.name);

  const { mutateAsync: updateBaseMutator } = useMutation({
    mutationFn: updateBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: routerSpaceId ? ['base-list', routerSpaceId] : ['base-list'],
      });
    },
  });

  const { mutate: deleteBaseMutator } = useMutation({
    mutationFn: deleteBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: routerSpaceId ? ['base-list', routerSpaceId] : ['base-list'],
      });
    },
  });

  const toggleRenameBase = async (e: React.FocusEvent<HTMLInputElement, Element>) => {
    const name = e.target.value;
    if (!name || name === base.name) {
      setRenaming(false);
      return;
    }
    await updateBaseMutator({
      baseId: base.id,
      updateBaseRo: { name },
    });
    setRenaming(false);
  };

  const onRename = () => {
    setRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 200);
  };

  const clickStopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const intoBase = () => {
    router.push({
      pathname: '/base/[baseId]',
      query: {
        baseId: base.id,
      },
    });
  };

  return (
    <Card
      className={classNames('group cursor-pointer hover:shadow-md', className)}
      onClick={intoBase}
    >
      <CardContent className="w-full h-full flex items-center px-4 py-6">
        <Database className="min-w-[3.5rem] w-14 h-14" />
        <div className="flex-1 h-full overflow-hidden">
          <div className="flex justify-between items-center gap-3 p-0.5">
            {renaming ? (
              <Input
                ref={inputRef}
                className="flex-1 h-7"
                value={baseName}
                onChange={(e) => setBaseName(e.target.value)}
                onBlur={toggleRenameBase}
                onClick={clickStopPropagation}
              />
            ) : (
              <h3 className="line-clamp-2 flex-1 px-4	" title={base.name}>
                {base.name}
              </h3>
            )}
            <div className="shrink-0">
              <BaseActionTrigger onDelete={() => deleteBaseMutator(base.id)} onRename={onRename}>
                <Button className="opacity-0 group-hover:opacity-100" variant={'ghost'} size={'sm'}>
                  <MoreHorizontal />
                </Button>
              </BaseActionTrigger>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
