import { useMutation } from '@tanstack/react-query';
import { sharePasswordSchema, type IShareViewMeta } from '@teable/core';
import { Edit, RefreshCcw, Qrcode } from '@teable/icons';
import type { View } from '@teable/sdk';
import { useTablePermission, useView } from '@teable/sdk';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
} from '@teable/ui-lib';
import { omit } from 'lodash';
import { QRCodeSVG } from 'qrcode.react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from './CopyButton';

const getShareUrl = ({ shareId, theme }: { shareId: string; theme?: string }) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.teable.io';
  const url = new URL(`/share/${shareId}/view`, origin);
  if (theme && theme !== 'system') {
    url.searchParams.append('theme', theme);
  }
  return url.toString();
};

export const SharePopover: React.FC<{
  children: (text: string, isActive?: boolean) => React.ReactNode;
}> = (props) => {
  const { children } = props;
  const view = useView();
  const { t } = useTranslation();
  const permission = useTablePermission();

  const ShareViewText = t('share.label');
  const [showPasswordDialog, setShowPasswordDialog] = useState<boolean>();
  const [sharePassword, setSharePassword] = useState<string>('');

  const { mutate: enableShareFn, isLoading: enableShareLoading } = useMutation({
    mutationFn: async (view: View) => view.apiEnableShare(),
  });

  const { mutate: disableShareFn, isLoading: disableShareLoading } = useMutation({
    mutationFn: async (view: View) => view.disableShare(),
  });

  const shareUrl = useMemo(() => {
    return view?.shareId ? getShareUrl({ shareId: view?.shareId }) : undefined;
  }, [view?.shareId]);

  if (!view) {
    return children(ShareViewText, false);
  }

  const { enableShare, shareMeta } = view;

  const setShareMeta = (shareMeta: IShareViewMeta) => {
    view.setShareMeta({ ...view.shareMeta, ...shareMeta });
  };

  const setEnableShare = async (enableShare: boolean) => {
    if (!view) {
      return;
    }
    if (enableShare) {
      await enableShareFn(view);
      setTimeout(() => {
        !view?.shareMeta && setShareMeta({ submit: { requireLogin: false, allow: true } });
      }, 100);
    } else {
      disableShareFn(view);
    }
  };

  const confirmSharePassword = async () => {
    await setShareMeta({ password: sharePassword });
    setShowPasswordDialog(false);
    setSharePassword('');
  };

  const closeSharePasswordDialog = () => {
    setSharePassword('');
    setShowPasswordDialog(false);
  };

  const onPasswordSwitchChange = (check: boolean) => {
    if (check) {
      setShowPasswordDialog(true);
      return;
    }
    view.setShareMeta(omit(view.shareMeta, 'password'));
  };

  const onSubmitRequireLoginChange = (check: boolean) => {
    if (!shareMeta?.submit) {
      return;
    }
    setShareMeta({ submit: { ...shareMeta?.submit, requireLogin: check } });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{children(ShareViewText, enableShare)}</PopoverTrigger>
      <PopoverContent className="w-96 space-y-4 p-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="share-switch">{t('share.statusLabel')}</Label>
          <Switch
            className="ml-auto"
            id="share-switch"
            checked={enableShare}
            disabled={enableShareLoading || disableShareLoading || !permission['view|share']}
            onCheckedChange={setEnableShare}
          />
        </div>
        <Separator />
        {enableShare ? (
          <>
            <div className="flex items-center gap-1">
              <Input className="h-7 grow" id="share-link" value={shareUrl} readOnly />

              <Popover>
                <PopoverTrigger asChild>
                  <Button size="xs" variant="outline">
                    <Qrcode />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="size-48 bg-white p-2">
                  {shareUrl && <QRCodeSVG value={shareUrl} className="size-full" />}
                </PopoverContent>
              </Popover>
              <CopyButton text={shareUrl as string} size="xs" variant="outline" />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size={'xs'} variant={'outline'} onClick={() => view.setRefreshLink()}>
                      <RefreshCcw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('share.genLink')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Separator />
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="share-password"
                  checked={Boolean(shareMeta?.password)}
                  onCheckedChange={onPasswordSwitchChange}
                />
                <Label className="text-xs" htmlFor="share-password">
                  {t('share.restrict')}
                </Label>
                {Boolean(shareMeta?.password) && (
                  <Button
                    className="hover:text-muted-foreground h-5 py-0"
                    variant={'link'}
                    size={'xs'}
                    onClick={() => setShowPasswordDialog(true)}
                  >
                    <Edit />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="share-required-login"
                  checked={Boolean(shareMeta?.submit?.requireLogin)}
                  onCheckedChange={onSubmitRequireLoginChange}
                />
                <Label className="text-xs" htmlFor="share-required-login">
                  {t('share.requireLogin')}
                </Label>
              </div>
            </div>
          </>
        ) : (
          <div className="text-muted-foreground text-center text-sm">
            {!enableShare && permission['view|share'] ? t('share.tips') : t('share.noPermission')}
          </div>
        )}
        <Dialog
          open={showPasswordDialog}
          onOpenChange={(open) => !open && closeSharePasswordDialog()}
        >
          <DialogTrigger asChild></DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{t('share.passwordTitle')}</DialogTitle>
              <DialogDescription>{t('share.passwordTips')}</DialogDescription>
            </DialogHeader>
            <Input
              className="h-8"
              type="password"
              value={sharePassword}
              onChange={(e) => setSharePassword(e.target.value)}
            />
            <DialogFooter>
              <Button size={'sm'} variant={'ghost'} onClick={() => closeSharePasswordDialog()}>
                {t('share.cancel')}
              </Button>
              <Button
                size={'sm'}
                onClick={confirmSharePassword}
                disabled={!sharePasswordSchema.safeParse(sharePassword).success}
              >
                {t('share.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PopoverContent>
    </Popover>
  );
};
