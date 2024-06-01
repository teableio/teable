import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { ChevronsLeft, TeableNew, ChevronDown } from '@teable/icons';
import { deleteBase, updateBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase } from '@teable/sdk/hooks';
import { Button, Input } from '@teable/ui-lib';
import { useRouter } from 'next/router';
import { useRef, useState } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { BaseActionTrigger } from '../../space/component/BaseActionTrigger';

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
    mutationFn: deleteBase,
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

  const hasReadPermission = hasPermission(base.role, 'base|read');
  const hasUpdatePermission = hasPermission(base.role, 'base|update');
  const hasDeletePermission = hasPermission(base.role, 'base|delete');

  const backSpace = () => {
    router.push({
      pathname: '/space/[spaceId]',
      query: { spaceId: base.spaceId },
    });
  };

  return (
    <>
      <div
        className="group relative size-6 shrink-0 cursor-pointer"
        onClick={backSpace}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            backSpace();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="absolute top-0 size-6 group-hover:opacity-0">
          {base.icon ? (
            <Emoji emoji={base.icon} size={'1.5rem'} />
          ) : (
            <TeableNew className="size-6 text-black" />
          )}
        </div>
        <ChevronsLeft className="absolute top-0 size-6 opacity-0 group-hover:opacity-100" />
      </div>
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
          />
        </form>
      ) : (
        <p className="truncate text-sm" title={base.name}>
          {base.name}
        </p>
      )}
      <BaseActionTrigger
        base={base}
        showRename={hasUpdatePermission}
        showDuplicate={hasReadPermission}
        showDelete={hasDeletePermission}
        onDelete={() => deleteBaseMutator(base.id)}
        onRename={onRename}
        align="start"
      >
        <Button className="h-7 w-5 shrink-0 px-0" size="xs" variant="ghost">
          <ChevronDown className="size-4" />
        </Button>
      </BaseActionTrigger>
    </>
  );
};
