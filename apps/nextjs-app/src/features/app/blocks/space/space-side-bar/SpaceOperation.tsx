import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { MoreHorizontal } from '@teable/icons';
import { deleteSpace, type IGetSpaceVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useRouter } from 'next/router';
import React, { useMemo } from 'react';
import { SpaceActionTrigger } from '@/features/app/blocks/space/component/SpaceActionTrigger';

interface ISpaceOperationProps {
  className?: string;
  space: IGetSpaceVo;
  onRename?: () => void;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}

export const SpaceOperation = (props: ISpaceOperationProps) => {
  const { space, className, onRename, open, setOpen } = props;
  const queryClient = useQueryClient();
  const router = useRouter();
  const menuPermission = useMemo(() => {
    return {
      spaceUpdate: hasPermission(space.role, 'space|update'),
      spaceDelete: hasPermission(space.role, 'space|delete'),
    };
  }, [space.role]);

  const { mutate: deleteSpaceMutator } = useMutation({
    mutationFn: deleteSpace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
    },
  });

  const onSpaceSetting = () => {
    router.push({
      pathname: '/space/[spaceId]/setting/general',
      query: { spaceId: space.id },
    });
  };

  if (!Object.values(menuPermission).some(Boolean)) {
    return null;
  }

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
    <div
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <SpaceActionTrigger
        space={space}
        showRename={menuPermission.spaceUpdate}
        showDelete={menuPermission.spaceDelete}
        showSpaceSetting={menuPermission.spaceUpdate}
        onDelete={() => deleteSpaceMutator(space.id)}
        onRename={onRename}
        onSpaceSetting={onSpaceSetting}
        open={open}
        setOpen={setOpen}
      >
        <div>
          <MoreHorizontal className={className} />
        </div>
      </SpaceActionTrigger>
    </div>
  );
};
