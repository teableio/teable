/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { Database, MoreHorizontal } from '@teable/icons';
import type { IGetBaseVo } from '@teable/openapi';
import { PinType, deleteBase, permanentDeleteBase, updateBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button, Card, CardContent, cn, Input } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useState, type FC, useRef } from 'react';
import { Emoji } from '../../components/emoji/Emoji';
import { EmojiPicker } from '../../components/emoji/EmojiPicker';
import { useChatPanelStore } from '../../components/sidebar/useChatPanelStore';
import { ColorBg } from './ColorBg';
import { BaseActionTrigger } from './component/BaseActionTrigger';
import { StarButton } from './space-side-bar/StarButton';

interface IBaseCard {
  base: IGetBaseVo;
  className?: string;
  spaceName?: string;
}

export const BaseCard: FC<IBaseCard> = (props) => {
  const { base, className, spaceName } = props;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<boolean>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [baseName, setBaseName] = useState<string>(base.name);
  const { open: openChatPanel } = useChatPanelStore();

  const { mutateAsync: updateBaseMutator } = useMutation({
    mutationFn: updateBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseAll(),
      });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.recentlyBase(),
      });
    },
  });

  const { mutate: deleteBaseMutator } = useMutation({
    mutationFn: ({ baseId, permanent }: { baseId: string; permanent?: boolean }) =>
      permanent ? permanentDeleteBase(baseId) : deleteBase(baseId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseAll(),
      });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.recentlyBase(),
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
    openChatPanel();
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

  const hasUpdatePermission = base.restrictedAuthority
    ? false
    : hasPermission(base.role, 'base|update');
  const hasDeletePermission = base.restrictedAuthority
    ? false
    : hasPermission(base.role, 'base|delete');
  const hasMovePermission = base.restrictedAuthority
    ? false
    : hasPermission(base.role, 'space|create');

  return (
    <Card
      className={cn(
        'relative group cursor-pointer hover:shadow-md overflow-x-hidden shadow-none',
        className
      )}
      onClick={intoBase}
    >
      <ColorBg emoji={base.icon || undefined} />
      <CardContent className="relative flex size-full items-center gap-3 px-4 py-0">
        <div onClick={(e) => hasUpdatePermission && clickStopPropagation(e)}>
          <EmojiPicker disabled={!hasUpdatePermission || renaming} onChange={iconChange}>
            <div className="size-12 rounded-lg bg-white bg-gradient-to-br from-background to-muted p-3 outline outline-1 outline-card-foreground/10 transition-all group-hover:outline-card-foreground/15 hover:shadow-lg">
              {base.icon ? <Emoji emoji={base.icon} size={24} /> : <Database className="size-6" />}
            </div>
          </EmojiPicker>
        </div>
        <div className="flex grow">
          <div className="flex grow justify-between">
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
                  onMouseDown={clickStopPropagation}
                />
              </form>
            ) : (
              <div className="flex-1">
                <h3 className="line-clamp-2 text-sm" title={base.name}>
                  {base.name}
                </h3>
                {spaceName && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={spaceName}>
                    {spaceName}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="absolute right-0 top-1 flex gap-2 px-1 md:opacity-0 md:group-hover:opacity-100">
            <StarButton
              className="size-6 rounded-full bg-gray-100/50 p-1 shadow backdrop-blur-sm transition-colors hover:bg-gray-200/80"
              id={base.id}
              type={PinType.Base}
            />
            <div
              className="shrink-0"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <BaseActionTrigger
                base={base}
                showRename={hasUpdatePermission}
                showDuplicate={hasUpdatePermission}
                showDelete={hasDeletePermission}
                showExport={hasUpdatePermission}
                showMove={hasMovePermission}
                onDelete={(permanent) => deleteBaseMutator({ baseId: base.id, permanent })}
                onRename={onRename}
              >
                <Button
                  variant="ghost"
                  size={'xs'}
                  className="size-6 rounded-full bg-gray-100/50 p-1 shadow backdrop-blur-sm transition-colors hover:bg-gray-200/80"
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
