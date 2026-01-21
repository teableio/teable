import { Trash2, Import, Settings, Pencil } from '@teable/icons';
import type { IGetSpaceVo } from '@teable/openapi';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useState } from 'react';
import { DeleteSpaceConfirm } from '@/features/app/components/space/DeleteSpaceConfirm';
import { spaceConfig } from '@/features/i18n/space.config';
import { SpaceInnerSettingModal, SettingTab } from '@overridable/SpaceInnerSettingModal';

interface ISpaceActionTrigger {
  space: IGetSpaceVo;
  showRename?: boolean;
  showDelete?: boolean;
  showImportBase?: boolean;
  showSettings?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  onPermanentDelete?: () => void;
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
    showImportBase,
    onDelete,
    onPermanentDelete,
    onRename,
    showSettings,
    open,
    setOpen,
    onImportBase,
  } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);

  const [settingModalOpen, setSettingModalOpen] = useState(false);
  const handleOpenSettings = useCallback(() => {
    setOpen?.(false);
    setSettingModalOpen(true);
  }, [setOpen, setSettingModalOpen]);

  if (!showDelete && !showRename && !showSettings) {
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
          {showImportBase && (
            <DropdownMenuItem onClick={() => onImportBase?.()}>
              <Import className="mr-2" />
              {t('space:spaceSetting.importBase')}
            </DropdownMenuItem>
          )}
          {showSettings && (
            <DropdownMenuItem onClick={handleOpenSettings}>
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
      <DeleteSpaceConfirm
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        spaceId={space.id}
        spaceName={space.name}
        onConfirm={onDelete}
        onPermanentConfirm={onPermanentDelete}
      />
      <SpaceInnerSettingModal
        open={settingModalOpen}
        setOpen={setSettingModalOpen}
        defaultTab={SettingTab.General}
      >
        <span className="hidden" />
      </SpaceInnerSettingModal>
    </>
  );
};
