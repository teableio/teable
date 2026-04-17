import { sharePasswordSchema } from '@teable/core';
import { Edit, Qrcode, RefreshCcw } from '@teable/icons';
import { Spin } from '@teable/ui-lib';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { QRCodeSVG } from 'qrcode.react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';
import { EmbedConfigPopover } from './EmbedConfigPopover';

interface IPermissionOption {
  active: boolean;
  label: string;
  desc: string;
  onClick: () => void;
}

export interface IBaseShareData {
  allowEdit?: boolean | null;
  allowSave?: boolean | null;
  allowCopy?: boolean | null;
  password?: string | boolean | null;
}

export interface IBaseShareContentProps {
  className?: string;
  header?: ReactNode;
  share: IBaseShareData | null;
  shareUrl: string;
  isCreateLoading?: boolean;
  isDeleteLoading?: boolean;
  isRefreshLoading?: boolean;
  permissionOptions: IPermissionOption[];
  onToggleShare: (enabled: boolean) => void;
  onUpdateSetting: (data: Record<string, unknown>) => void;
  onDeleteShare: () => void;
  onRefreshShare: () => void;
}

export const BaseShareContent = ({
  className,
  header,
  share,
  shareUrl,
  isCreateLoading,
  isDeleteLoading,
  isRefreshLoading,
  permissionOptions,
  onToggleShare,
  onUpdateSetting,
  onDeleteShare,
  onRefreshShare,
}: IBaseShareContentProps) => {
  const { t } = useTranslation(['common']);

  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleToggleShare = (enabled: boolean) => {
    if (enabled) {
      onToggleShare(true);
    } else {
      setShowDeleteConfirm(true);
    }
  };

  const handlePasswordSwitchChange = (checked: boolean) => {
    if (checked) {
      setShowPasswordDialog(true);
    } else {
      onUpdateSetting({ password: null });
    }
  };

  const confirmSharePassword = () => {
    onUpdateSetting({ password: sharePassword });
    setShowPasswordDialog(false);
    setSharePassword('');
  };

  const closeSharePasswordDialog = () => {
    setSharePassword('');
    setShowPasswordDialog(false);
  };

  const isShareEnabled = !!share;

  const activePermission = permissionOptions.find((o) => o.active);

  return (
    <div className={cn('flex w-full flex-col gap-4', className)}>
      {header}

      <div className="flex items-center gap-2">
        {isCreateLoading ? (
          <Spin className="size-5" />
        ) : (
          <Switch id="share-switch" checked={isShareEnabled} onCheckedChange={handleToggleShare} />
        )}
        <Label htmlFor="share-switch" className="text-sm">
          {t('baseShare.shareToWeb')}
        </Label>
      </div>

      {isShareEnabled && share && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">{t('baseShare.linkHolderLabel')}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex items-center gap-0.5 font-medium text-blue-500 hover:text-blue-600">
                    {activePermission?.label}
                    <ChevronDown className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {permissionOptions.map((item) => (
                    <DropdownMenuItem
                      key={item.label}
                      className={item.active ? 'font-medium' : ''}
                      onClick={item.onClick}
                    >
                      <div className="flex items-start gap-1.5">
                        {item.active ? (
                          <Check className="mt-0.5 size-4 shrink-0" />
                        ) : (
                          <span className="mt-0.5 size-4 shrink-0" />
                        )}
                        <div className="flex flex-col gap-1">
                          <span>{item.label}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {item.desc}
                          </span>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center gap-2">
              <Input className="min-w-0 flex-1" value={shareUrl} readOnly />
              <CopyButton text={shareUrl} variant="outline" size="icon-sm" className="shrink-0" />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon-sm" className="shrink-0">
                    <Qrcode className="size-4 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="size-48 bg-white p-2">
                  <QRCodeSVG value={shareUrl} className="size-full" />
                </PopoverContent>
              </Popover>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="shrink-0"
                      onClick={onRefreshShare}
                      disabled={isRefreshLoading}
                    >
                      {isRefreshLoading ? (
                        <Spin className="size-4" />
                      ) : (
                        <RefreshCcw className="size-4 shrink-0" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{t('baseShare.refreshLink')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <Label className="text-sm font-medium">{t('baseShare.advanced')}</Label>

            <div className="flex items-center gap-2">
              <Switch
                id="share-allowCopy"
                checked={Boolean(share.allowCopy)}
                onCheckedChange={(checked) => onUpdateSetting({ allowCopy: checked })}
              />
              <Label className="text-sm font-normal" htmlFor="share-allowCopy">
                {t('baseShare.allowCopyData')}
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="share-password"
                checked={Boolean(share.password)}
                onCheckedChange={handlePasswordSwitchChange}
              />
              <Label className="text-sm font-normal" htmlFor="share-password">
                {t('baseShare.restrictByPassword')}
              </Label>
              {Boolean(share.password) && (
                <Button
                  className="h-5 px-1 hover:text-muted-foreground"
                  variant="link"
                  size="xs"
                  onClick={() => setShowPasswordDialog(true)}
                >
                  <Edit className="size-4" />
                </Button>
              )}
            </div>

            <EmbedConfigPopover shareUrl={shareUrl} />
          </div>
        </>
      )}

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('baseShare.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('baseShare.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDeleteShare();
                setShowDeleteConfirm(false);
              }}
              disabled={isDeleteLoading}
            >
              {isDeleteLoading && <Spin className="mr-2 size-4" />}
              {t('common:actions.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={showPasswordDialog}
        onOpenChange={(open) => !open && closeSharePasswordDialog()}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('baseShare.passwordTitle')}</DialogTitle>
          </DialogHeader>
          <Input
            size="lg"
            type="password"
            value={sharePassword}
            onChange={(e) => setSharePassword(e.target.value)}
            placeholder={t('baseShare.enterPassword')}
          />
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={closeSharePasswordDialog}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={confirmSharePassword}
              disabled={!sharePasswordSchema.safeParse(sharePassword).success}
            >
              {t('common:actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
