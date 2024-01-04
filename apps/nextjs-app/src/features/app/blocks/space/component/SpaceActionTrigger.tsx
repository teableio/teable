import { Pencil, Trash2 } from '@teable-group/icons';
import type { IGetSpaceVo } from '@teable-group/openapi';
import { ConfirmDialog } from '@teable-group/ui-lib/base';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable-group/ui-lib/shadcn';
import React from 'react';

interface ISpaceActionTrigger {
  space: IGetSpaceVo;
  showRename?: boolean;
  showDelete?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
}

export const SpaceActionTrigger: React.FC<React.PropsWithChildren<ISpaceActionTrigger>> = (
  props
) => {
  const { space, children, showDelete, showRename, onDelete, onRename } = props;
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  if (!showDelete && !showRename) {
    return null;
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showRename && (
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="mr-2" />
              Rename
            </DropdownMenuItem>
          )}
          {showDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirm(true)}>
                <Trash2 className="mr-2" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title={`Are you sure you want to delete ${space?.name}?`}
        cancelText="Cancel"
        confirmText="Continue"
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={onDelete}
      />
    </>
  );
};
