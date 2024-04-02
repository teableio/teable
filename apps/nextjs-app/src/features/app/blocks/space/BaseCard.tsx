import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { Database, MoreHorizontal } from '@teable/icons';
import type { IGetBaseVo } from '@teable/openapi';
import { deleteBase, updateBase } from '@teable/openapi';
import { Button, Card, CardContent, cn, Input } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useState, type FC, useRef } from 'react';
import { Emoji } from '../../components/emoji/Emoji';
import { EmojiPicker } from '../../components/emoji/EmojiPicker';
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
        queryKey: routerSpaceId ? ['base-list', routerSpaceId] : ['base-all'],
      });
    },
  });

  const { mutate: deleteBaseMutator } = useMutation({
    mutationFn: deleteBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: routerSpaceId ? ['base-list', routerSpaceId] : ['base-all'],
      });
    },
  });

  const toggleRenameBase = async () => {
    if (baseName && baseName !== base.name) {
      await updateBaseMutator({
        baseId: base.id,
        updateBaseRo: { name: baseName },
      });
    }
    setTimeout(() => setRenaming(false), 200);
  };

  const onRename = () => {
    setRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 200);
  };

  const clickStopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const intoBase = () => {
    if (renaming) {
      return;
    }
    router.push({
      pathname: '/base/[baseId]',
      query: {
        baseId: base.id,
      },
    });
  };

  const iconChange = (icon: string) => {
    updateBaseMutator({
      baseId: base.id,
      updateBaseRo: { icon },
    });
  };

  const hasReadPermission = hasPermission(base.role, 'base|read');
  const hasUpdatePermission = hasPermission(base.role, 'base|update');
  const hasDeletePermission = hasPermission(base.role, 'base|delete');
  return (
    <Card className={cn('group cursor-pointer hover:shadow-md', className)} onClick={intoBase}>
      <CardContent className="flex size-full items-center px-4 py-6">
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div onClick={(e) => hasUpdatePermission && clickStopPropagation(e)}>
          <EmojiPicker disabled={!hasUpdatePermission || renaming} onChange={iconChange}>
            {base.icon ? (
              <div className="size-14 min-w-14 text-[3.5rem] leading-none">
                <Emoji emoji={base.icon} size={56} />
              </div>
            ) : (
              <Database className="size-14 min-w-14" />
            )}
          </EmojiPicker>
        </div>
        <div className="h-full flex-1 overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-0.5">
            {renaming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  toggleRenameBase();
                }}
              >
                <Input
                  ref={inputRef}
                  className="h-7 flex-1"
                  value={baseName}
                  onChange={(e) => setBaseName(e.target.value)}
                  onBlur={toggleRenameBase}
                  onClick={clickStopPropagation}
                />
              </form>
            ) : (
              <h3 className="line-clamp-2 flex-1 px-4	" title={base.name}>
                {base.name}
              </h3>
            )}
            <div className="shrink-0">
              <BaseActionTrigger
                base={base}
                showRename={hasUpdatePermission}
                showDuplicate={hasReadPermission}
                showDelete={hasDeletePermission}
                onDelete={() => deleteBaseMutator(base.id)}
                onRename={onRename}
              >
                <Button
                  className="sm:opacity-0 sm:group-hover:opacity-100"
                  variant="outline"
                  size={'xs'}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </BaseActionTrigger>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
