import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable-group/ui-lib/shadcn';
import React from 'react';

interface IBaseActionTrigger {
  onRename?: () => void;
  onDelete?: () => void;
}

export const BaseActionTrigger: React.FC<React.PropsWithChildren<IBaseActionTrigger>> = (props) => {
  const { children, onDelete, onRename } = props;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
