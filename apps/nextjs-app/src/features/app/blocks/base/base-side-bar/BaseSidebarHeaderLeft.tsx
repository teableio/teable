import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { ChevronsLeft, ChevronDown, Menu } from '@teable/icons';
import { CollaboratorType, deleteBase, permanentDeleteBase, updateBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase } from '@teable/sdk/hooks';
import { Button, Input } from '@teable/ui-lib';
import { useRouter } from 'next/router';
import { useRef, useState } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { BaseActionTrigger } from '../../space/component/BaseActionTrigger';
import { BaseListTrigger } from '../../space/component/BaseListTrigger';

export const BaseSidebarHeaderLeft = () => {
  const base = useBase();
  const router = useRouter();
  const [renaming, setRenaming] = useState<boolean>();
  const [baseName, setBaseName] = useState<string>(base.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { mutateAsync: updateBaseMutator } = useMutation({
    mutationFn: updateBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.base(base.id),
      });
    },
  });

  const { mutate: deleteBaseMutator } = useMutation({
    mutationFn: ({ baseId, permanent }: { baseId: string; permanent?: boolean }) =>
      permanent ? permanentDeleteBase(baseId) : deleteBase(baseId),
    onSuccess: () => {
      router.push({
        pathname: '/space/[spaceId]',
        query: { spaceId: base.spaceId },
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

  const hasUpdatePermission = hasPermission(base.role, 'base|update');
  const hasDeletePermission = hasPermission(base.role, 'base|delete');
  const hasMovePermission = hasPermission(base.role, 'space|create');

  const backSpace = () => {
    if (base.collaboratorType === CollaboratorType.Base) {
      router.push({
        pathname: '/space/shared-base',
      });
    } else {
      router.push({
        pathname: '/space/[spaceId]',
        query: { spaceId: base.spaceId },
      });
    }
  };

  return (
    <div className="flex max-w-[calc(100%-28px)] shrink grow items-center">
      <div
        className="relative mr-2 size-6 shrink-0 cursor-pointer"
        onClick={backSpace}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            backSpace();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="absolute top-0 size-6 transition-all group-hover/sidebar:opacity-0">
          {base.icon ? (
            <Emoji emoji={base.icon} size={'1.5rem'} />
          ) : (
            <TeableLogo className="size-6 text-black" />
          )}
        </div>
        <ChevronsLeft className="absolute top-0 size-6 opacity-0 transition-all group-hover/sidebar:opacity-100" />
      </div>
      <div className="flex shrink grow items-center gap-1 overflow-hidden p-1">
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              toggleRenameBase();
            }}
          >
            <Input
              ref={inputRef}
              className="h-7 flex-1 shrink"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
              onBlur={toggleRenameBase}
            />
          </form>
        ) : (
          <p className="shrink truncate text-sm" title={base.name}>
            {base.name}
          </p>
        )}
        <BaseActionTrigger
          base={base}
          showRename={hasUpdatePermission}
          showDuplicate={hasUpdatePermission}
          showDelete={hasDeletePermission}
          showExport={hasUpdatePermission}
          showMove={hasMovePermission}
          onDelete={(permanent) => deleteBaseMutator({ baseId: base.id, permanent })}
          onRename={onRename}
          align="start"
        >
          <Button className="h-7 w-5 shrink-0 px-0" size="xs" variant="ghost">
            <ChevronDown className="size-4" />
          </Button>
        </BaseActionTrigger>
      </div>
      <BaseListTrigger spaceId={base.spaceId} collaboratorType={base.collaboratorType}>
        <Button className="h-7 w-5 shrink-0 px-0" size="xs" variant="ghost">
          <Menu className="size-4" />
        </Button>
      </BaseListTrigger>
    </div>
  );
};
