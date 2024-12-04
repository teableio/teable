import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { Component } from '@teable/icons';
import { PinType, type IGetSpaceVo, updateSpace } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { Input } from '@teable/ui-lib';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useClickAway, useMount } from 'react-use';
import { SpaceOperation } from '@/features/app/blocks/space/space-side-bar/SpaceOperation';
import { ItemButton } from './ItemButton';
import { StarButton } from './StarButton';

interface IProps {
  space: IGetSpaceVo;
  isActive: boolean;
}

export const SpaceItem: React.FC<IProps> = ({ space, isActive }) => {
  const { id, name } = space;
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const { mutateAsync: updateSpaceMutator } = useMutation({
    mutationFn: updateSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.space(space.id) });
    },
  });

  useEffect(() => {
    if (isEditing) setTimeout(() => inputRef.current?.focus());
  }, [isEditing]);

  useClickAway(inputRef, async () => {
    if (isEditing && inputRef.current?.value && inputRef.current.value !== space.name)
      await updateSpaceMutator({
        spaceId: space.id,
        updateSpaceRo: { name: inputRef.current.value },
      });
    setIsEditing(false);
  });

  useMount(() => {
    isActive && ref.current?.scrollIntoView({ block: 'center' });
  });

  return (
    <div className="relative overflow-y-auto">
      <ItemButton className="group" isActive={isActive} ref={ref}>
        <Link
          href={{
            pathname: '/space/[spaceId]',
            query: {
              spaceId: id,
            },
          }}
          title={name}
          onContextMenu={() => setOpen(true)}
          onDoubleClick={() => hasPermission(space.role, 'space|update') && setIsEditing(true)}
        >
          <Component className="size-4 shrink-0" />
          <p className="grow truncate">{' ' + name}</p>
          <StarButton id={id} type={PinType.Space} />

          <SpaceOperation
            space={space}
            onRename={() => setIsEditing(true)}
            open={open}
            setOpen={setOpen}
            className="size-4 shrink-0 sm:opacity-0 sm:group-hover:opacity-100"
          />
        </Link>
      </ItemButton>
      {isEditing && (
        <Input
          ref={inputRef}
          type="text"
          placeholder="name"
          defaultValue={space.name}
          style={{
            boxShadow: 'none',
          }}
          className="round-none absolute left-0 top-0 size-full cursor-text bg-background px-4 outline-none"
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              if (e.currentTarget.value && e.currentTarget.value !== space.name)
                await updateSpaceMutator({
                  spaceId: space.id,
                  updateSpaceRo: { name: e.currentTarget.value },
                });
              setIsEditing(false);
            }
          }}
        />
      )}
    </div>
  );
};
