import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable-group/ui-lib/shadcn';
import React from 'react';

interface ISpaceActionTrigger {
  onRename?: () => void;
  onDelete?: () => void;
}

export const SpaceActionTrigger: React.FC<React.PropsWithChildren<ISpaceActionTrigger>> = (
  props
) => {
  const { children, onDelete, onRename } = props;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
