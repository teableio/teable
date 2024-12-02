import { useMutation } from '@tanstack/react-query';
import { sharePasswordSchema, type IShareViewMeta, ViewType } from '@teable/core';
import { Edit, RefreshCcw, Qrcode } from '@teable/icons';
import { useTablePermission, useView } from '@teable/sdk/hooks';
import type { View } from '@teable/sdk/model';
import {
  Button,
  Dialog,
  DialogClose,
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
  RadioGroup,
  RadioGroupItem,
  Separator,
  Switch,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { omit } from 'lodash';
import { LucideEye } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { useMemo, useState } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';
import { tableConfig } from '@/features/i18n/table.config';

const getShareUrl = ({
  shareId,
  theme,
  hideToolBar,
}: {
  shareId: string;
  theme?: string;
  hideToolBar?: boolean;
}) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.teable.io';
  const url = new URL(`/share/${shareId}/view`, origin);
  if (theme && theme !== 'system') {
    url.searchParams.append('theme', theme);
  }
  if (hideToolBar) {
    url.searchParams.append('hideToolBar', 'true');
  }
  return url.toString();
};

const embedUrl = (shareUrl: string) => {
  const url = new URL(shareUrl);
  url.searchParams.append('embed', 'true');
  return url.toString();
};

export const SharePopover: React.FC<{
  children: (text: string, isActive?: boolean) => React.ReactNode;
}> = (props) => {
  const { children } = props;
  const view = useView();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const permission = useTablePermission();

  const ShareViewText = t('table:toolbar.others.share.label');
  const [showPasswordDialog, setShowPasswordDialog] = useState<boolean>();
  const [sharePassword, setSharePassword] = useState<string>('');
  const [shareTheme, setShareTheme] = useState<string>('system');
  const [hideToolBar, setHideToolBar] = useState<boolean>();
  const [embed, setEmbed] = useState<boolean>();

  const { mutate: enableShareFn, isLoading: enableShareLoading } = useMutation({
    mutationFn: async (view: View) => view.apiEnableShare(),
  });

  const { mutate: disableShareFn, isLoading: disableShareLoading } = useMutation({
    mutationFn: async (view: View) => view.disableShare(),
  });

  const shareUrl = useMemo(() => {
    return view?.shareId
      ? getShareUrl({ shareId: view?.shareId, theme: shareTheme, hideToolBar })
      : undefined;
  }, [view?.shareId, shareTheme, hideToolBar]);
  const embedHtml = shareUrl
    ? `<iframe src="${embedUrl(shareUrl)}" width="100%" height="533" style="border: 0"></iframe>`
    : '';

  if (!view) {
    return children(ShareViewText, false);
  }

  const { enableShare, shareMeta } = view;

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

  const onSubmitRequireLoginChange = (check: boolean) => {
    if (!shareMeta?.submit) {
      return;
    }
    setShareMeta({ submit: { ...shareMeta?.submit, requireLogin: check } });
  };

  const needConfigCopy = [ViewType.Grid].includes(view.type);
  const needConfigIncludeHiddenField = [ViewType.Grid].includes(view.type);
  const needEmbedHiddenToolbar = ![ViewType.Form].includes(view.type);

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
              {shareMeta?.submit && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="share-required-login"
                    checked={Boolean(shareMeta?.submit?.requireLogin)}
                    onCheckedChange={onSubmitRequireLoginChange}
                  />
                  <Label className="text-xs" htmlFor="share-required-login">
                    {t('table:toolbar.others.share.requireLogin')}
                  </Label>
                </div>
              )}
            </div>
            <hr />
            <div>
              <p className="text-sm">{t('table:toolbar.others.share.URLSetting')}</p>
              <p className="text-xs text-primary/60">
                {t('table:toolbar.others.share.URLSettingDescription')}
              </p>
            </div>
            {needEmbedHiddenToolbar && (
              <div className="flex items-center gap-2">
                <Switch
                  id="share-hideToolBar"
                  checked={hideToolBar}
                  onCheckedChange={(checked) => setHideToolBar(checked)}
                />
                <Label className="text-xs" htmlFor="share-hideToolBar">
                  {t('table:toolbar.others.share.hideToolbar')}
                </Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id="share-embed"
                checked={embed}
                onCheckedChange={(checked) => setEmbed(checked)}
              />
              <Label className="text-xs" htmlFor="share-embed">
                {t('table:toolbar.others.share.embed')}
              </Label>
              {embed && shareUrl && (
                <>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="xs" variant="outline">
                        <LucideEye className="size-3" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px] md:max-w-[600px] lg:max-w-[800px]">
                      <DialogHeader>
                        <DialogTitle>{t('table:toolbar.others.share.embedPreview')}</DialogTitle>
                      </DialogHeader>
                      <div className="h-[500px]">
                        <iframe
                          src={embedUrl(shareUrl)}
                          title="embed view"
                          width="100%"
                          height="100%"
                          style={{ border: 0 }}
                        />
                      </div>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button size={'sm'} variant={'ghost'}>
                            {t('common:actions.close')}
                          </Button>
                        </DialogClose>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <CopyButton text={embedHtml as string} size="xs" variant="outline" />
                </>
              )}
            </div>
            {embed && <Textarea className="h-20 font-mono text-xs" value={embedHtml} readOnly />}
            <div className="flex gap-4">
              <Label className="text-xs" htmlFor="share-password">
                {t('common:settings.setting.theme')}
              </Label>
              <RadioGroup
                className="flex gap-2"
                defaultValue={shareTheme}
                onValueChange={(e) => setShareTheme(e)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="system" id="r1" />
                  <Label className="text-xs font-normal" htmlFor="r1">
                    {t('common:settings.setting.system')}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="light" id="r2" />
                  <Label className="text-xs font-normal" htmlFor="r2">
                    {t('common:settings.setting.light')}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="dark" id="r3" />
                  <Label className="text-xs font-normal" htmlFor="r3">
                    {t('common:settings.setting.dark')}
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </>
        ) : (
          <div className="text-center text-sm text-muted-foreground">
            {!enableShare && permission['view|share']
              ? t('table:toolbar.others.share.tips')
              : t('table:toolbar.others.share.noPermission')}
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
