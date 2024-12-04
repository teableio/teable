import { Pencil, Settings, Trash2 } from '@teable/icons';
import type { IGetSpaceVo } from '@teable/openapi';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { Trans, useTranslation } from 'next-i18next';
import React from 'react';
import { spaceConfig } from '@/features/i18n/space.config';

interface ISpaceActionTrigger {
  space: IGetSpaceVo;
  showRename?: boolean;
  showDelete?: boolean;
  showSpaceSetting?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  onSpaceSetting?: () => void;
  open?: boolean;
  setOpen?: (open: boolean) => void;
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
    onDelete,
    onRename,
    onSpaceSetting,
    open,
    setOpen,
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
      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title={
          <Trans ns="space" i18nKey={'tip.delete'}>
            {space?.name}
          </Trans>
        }
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={onDelete}
      />
    </>
  );
};
