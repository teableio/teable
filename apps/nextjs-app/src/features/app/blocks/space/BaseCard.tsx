import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { Database, MoreHorizontal } from '@teable/icons';
import type { IGetBaseVo } from '@teable/openapi';
import { PinType, deleteBase, updateBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button, Card, CardContent, cn, Input } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useState, type FC, useRef } from 'react';
import { Emoji } from '../../components/emoji/Emoji';
import { EmojiPicker } from '../../components/emoji/EmojiPicker';
import { BaseActionTrigger } from './component/BaseActionTrigger';
import { StarButton } from './space-side-bar/StarButton';

interface IBaseCard {
  base: IGetBaseVo;
  className?: string;
}

export const BaseCard: FC<IBaseCard> = (props) => {
  const { base, className } = props;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<boolean>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [baseName, setBaseName] = useState<string>(base.name);

  const { mutateAsync: updateBaseMutator } = useMutation({
    mutationFn: updateBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseAll(),
      });
    },
  });

  const { mutate: deleteBaseMutator } = useMutation({
    mutationFn: deleteBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseAll(),
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
      <CardContent className="flex size-full items-center gap-3 px-4 py-6">
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
        <div className="h-full flex-1">
          <div className="relative flex justify-between gap-3 p-0.5">
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
              <h3 className="line-clamp-2 flex-1" title={base.name}>
                {base.name}
              </h3>
            )}
            <div className="right-0 flex items-center gap-3 md:absolute md:translate-x-full md:opacity-0 md:group-hover:relative md:group-hover:translate-x-0 md:group-hover:opacity-100">
              <StarButton className="size-4 opacity-100" id={base.id} type={PinType.Base} />
              <div className="shrink-0">
                <BaseActionTrigger
                  base={base}
                  showRename={hasUpdatePermission}
                  showDuplicate={hasReadPermission}
                  showDelete={hasDeletePermission}
                  onDelete={() => deleteBaseMutator(base.id)}
                  onRename={onRename}
                >
                  <Button variant="outline" size={'xs'}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </BaseActionTrigger>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
