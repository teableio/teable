import { Pencil, Settings, Trash2, Import } from '@teable/icons';
import type { IGetSpaceVo } from '@teable/openapi';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { DeleteSpaceConfirm } from '@/features/app/components/space/DeleteSpaceConfirm';
import { spaceConfig } from '@/features/i18n/space.config';

interface ISpaceActionTrigger {
  space: IGetSpaceVo;
  showRename?: boolean;
  showDelete?: boolean;
  showSpaceSetting?: boolean;
  showImportBase?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  onPermanentDelete?: () => void;
  onSpaceSetting?: () => void;
  open?: boolean;
  setOpen?: (open: boolean) => void;
  onImportBase?: () => void;
}

export const SpaceActionTrigger: React.FC<React.PropsWithChildren<ISpaceActionTrigger>> = (
  props
) => {
  const {
    space,
    children,
    showDelete,
    showRename,
    showSpaceSetting,
    showImportBase,
    onDelete,
    onPermanentDelete,
    onRename,
    onSpaceSetting,
    open,
    setOpen,
    onImportBase,
  } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);

  if (!showDelete && !showRename) {
    return null;
  }
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showRename && (
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="mr-2" />
              {t('actions.rename')}
            </DropdownMenuItem>
          )}
          {showSpaceSetting && (
            <DropdownMenuItem onClick={onSpaceSetting}>
              <Settings className="mr-2" />
              {t('space:spaceSetting.title')}
            </DropdownMenuItem>
          )}
          {showImportBase && (
            <DropdownMenuItem onClick={() => onImportBase?.()}>
              <Import className="mr-2" />
              {t('space:spaceSetting.importBase')}
            </DropdownMenuItem>
          )}
          {showDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirm(true)}>
                <Trash2 className="mr-2" />
                {t('actions.delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteSpaceConfirm
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        spaceId={space.id}
        spaceName={space.name}
        onConfirm={onDelete}
        onPermanentConfirm={onPermanentDelete}
      />
    </>
  );
};
