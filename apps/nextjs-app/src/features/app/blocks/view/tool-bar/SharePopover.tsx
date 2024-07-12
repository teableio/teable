import { useMutation } from '@tanstack/react-query';
import { sharePasswordSchema, type IShareViewMeta, ViewType } from '@teable/core';
import { Copy, Edit, RefreshCcw, Qrcode } from '@teable/icons';
import { useView } from '@teable/sdk/hooks';
import type { View } from '@teable/sdk/model';
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
import { debounce, omit } from 'lodash';
import { useTranslation } from 'next-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { useMemo, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

const getShareUrl = (shareId: string) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/share/${shareId}/view`;
};

export const SharePopover: React.FC<{
  children: (text: string, isActive?: boolean) => React.ReactNode;
}> = (props) => {
  const { children } = props;
  const view = useView();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const ShareViewText = t('table:toolbar.others.share.label');
  const [copyTooltip, setCopyTooltip] = useState<boolean>(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState<boolean>();
  const [sharePassword, setSharePassword] = useState<string>('');

  const { mutate: enableShareFn, isLoading: enableShareLoading } = useMutation({
    mutationFn: async (view: View) => view.apiEnableShare(),
  });

  const { mutate: disableShareFn, isLoading: disableShareLoading } = useMutation({
    mutationFn: async (view: View) => view.disableShare(),
  });

  const resetCopyTooltip = useMemo(() => {
    return debounce(setCopyTooltip, 1000);
  }, []);

  const shareUrl = useMemo(() => {
    return view?.shareId ? getShareUrl(view?.shareId) : undefined;
  }, [view?.shareId]);

  if (!view) {
    return children(ShareViewText, false);
  }

  const { enableShare, shareMeta } = view;

  const copyShareLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopyTooltip(true);
    resetCopyTooltip(false);
  };

  const setShareMeta = (shareMeta: IShareViewMeta) => {
    view.setShareMeta({ ...view.shareMeta, ...shareMeta });
  };

  const setEnableShare = (enableShare: boolean) => {
    if (!view) {
      return;
    }
    if (enableShare) {
      return enableShareFn(view);
    }
    disableShareFn(view);
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

  const needConfigCopy = [ViewType.Grid].includes(view.type);
  const needConfigIncludeHiddenField = [ViewType.Grid].includes(view.type);

  return (
    <Popover>
      <PopoverTrigger asChild>{children(ShareViewText, enableShare)}</PopoverTrigger>
      <PopoverContent className="w-96 space-y-4 p-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="share-switch">{t('table:toolbar.others.share.statusLabel')}</Label>
          <Switch
            className="ml-auto"
            id="share-switch"
            checked={enableShare}
            disabled={enableShareLoading || disableShareLoading}
            onCheckedChange={setEnableShare}
          />
        </div>
        <Separator />
        {enableShare ? (
          <>
            <div className="flex items-center gap-1">
              <Label className="sr-only" htmlFor="share-link">
                Share Link
              </Label>
              <Input className="h-7 grow" id="share-link" placeholder={shareUrl} readOnly />

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

              <TooltipProvider disableHoverableContent={true}>
                <Tooltip open={copyTooltip}>
                  <TooltipTrigger asChild>
                    <Button size="xs" variant="outline" onClick={copyShareLink}>
                      <Copy />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      <p>{t('table:toolbar.others.share.copied')}</p>
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size={'xs'} variant={'outline'} onClick={() => view.setRefreshLink()}>
                      <RefreshCcw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('table:toolbar.others.share.genLink')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Separator />
            <div className="space-y-4">
              {needConfigCopy && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="share-allowCopy"
                    checked={shareMeta?.allowCopy}
                    onCheckedChange={(checked) => setShareMeta({ allowCopy: checked })}
                  />
                  <Label className="text-xs" htmlFor="share-allowCopy">
                    {t('table:toolbar.others.share.allowCopy')}
                  </Label>
                </div>
              )}
              {needConfigIncludeHiddenField && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="share-includeHiddenField"
                    checked={shareMeta?.includeHiddenField}
                    onCheckedChange={(checked) => setShareMeta({ includeHiddenField: checked })}
                  />
                  <Label className="text-xs" htmlFor="share-includeHiddenField">
                    {t('table:toolbar.others.share.showAllFields')}
                  </Label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Switch
                  id="share-password"
                  checked={Boolean(shareMeta?.password)}
                  onCheckedChange={onPasswordSwitchChange}
                />
                <Label className="text-xs" htmlFor="share-password">
                  {t('table:toolbar.others.share.restrict')}
                </Label>
                {Boolean(shareMeta?.password) && (
                  <Button
                    className="h-5 py-0 hover:text-muted-foreground"
                    variant={'link'}
                    size={'xs'}
                    onClick={() => setShowPasswordDialog(true)}
                  >
                    <Edit />
                  </Button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-center text-sm text-muted-foreground">
            {t('table:toolbar.others.share.tips')}
          </div>
        )}
        <Dialog
          open={showPasswordDialog}
          onOpenChange={(open) => !open && closeSharePasswordDialog()}
        >
          <DialogTrigger asChild></DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{t('table:toolbar.others.share.passwordTitle')}</DialogTitle>
              <DialogDescription>{t('table:toolbar.others.share.passwordTips')}</DialogDescription>
            </DialogHeader>
            <Input
              className="h-8"
              type="password"
              value={sharePassword}
              onChange={(e) => setSharePassword(e.target.value)}
            />
            <DialogFooter>
              <Button size={'sm'} variant={'ghost'} onClick={() => closeSharePasswordDialog()}>
                {t('table:toolbar.others.share.cancel')}
              </Button>
              <Button
                size={'sm'}
                onClick={confirmSharePassword}
                disabled={!sharePasswordSchema.safeParse(sharePassword).success}
              >
                {t('table:toolbar.others.share.save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PopoverContent>
    </Popover>
  );
};
