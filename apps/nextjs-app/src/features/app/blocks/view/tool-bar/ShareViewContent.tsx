import { useMutation } from '@tanstack/react-query';
import { sharePasswordSchema, type IShareViewMeta, ViewType } from '@teable/core';
import { Copy, Edit, RefreshCcw, Qrcode } from '@teable/icons';
import { useTablePermission, useView } from '@teable/sdk/hooks';
import type { View } from '@teable/sdk/model';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  Separator,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { omit } from 'lodash';
import { ChevronRight, Eye } from 'lucide-react';
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
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.teable.ai';
  const url = new URL(`/share/${shareId}/view`, origin);
  if (theme && theme !== 'system') {
    url.searchParams.append('theme', theme);
  }
  if (hideToolBar) {
    url.searchParams.append('hideToolBar', 'true');
  }
  return url.toString();
};

const getEmbedUrl = (shareUrl: string) => {
  const url = new URL(shareUrl);
  url.searchParams.append('embed', 'true');
  return url.toString();
};

const getEmbedHtml = (shareUrl: string) => {
  const embedUrl = getEmbedUrl(shareUrl);
  return `<iframe src="${embedUrl}" width="100%" height="533" style="border: 0"></iframe>`;
};

const EmbedConfigPopover = ({
  shareUrl,
  hideToolBar,
  setHideToolBar,
  shareTheme,
  setShareTheme,
  needEmbedHiddenToolbar,
}: {
  shareUrl: string;
  hideToolBar?: boolean;
  setHideToolBar: (v: boolean) => void;
  shareTheme: string;
  setShareTheme: (v: string) => void;
  needEmbedHiddenToolbar: boolean;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [previewOpen, setPreviewOpen] = useState(false);

  const embedHtml = getEmbedHtml(shareUrl);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(embedHtml);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="-mx-2 flex w-[calc(100%+16px)] items-center justify-between px-2 py-1"
        >
          <Label className="cursor-pointer text-sm font-normal">
            {t('table:baseShare.embedConfig')}
          </Label>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80">
        <div className="mb-3 rounded-md border bg-muted p-3">
          <code className="break-all text-xs">{embedHtml}</code>
        </div>

        <div className="flex gap-2">
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="mr-1 size-4" />
              {t('table:toolbar.others.share.embedPreview')}
            </Button>
            <DialogContent className="sm:max-w-[425px] md:max-w-[600px] lg:max-w-[800px]">
              <DialogHeader>
                <DialogTitle>{t('table:toolbar.others.share.embedPreview')}</DialogTitle>
              </DialogHeader>
              <div className="h-[500px] overflow-hidden rounded-lg border">
                <iframe
                  src={getEmbedUrl(shareUrl)}
                  title="embed view"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                />
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" className="flex-1" onClick={handleCopyCode}>
            <Copy className="mr-1 size-4" />
            {t('table:toolbar.others.share.copyCode')}
          </Button>
        </div>

        <Separator className="my-3" />

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('table:toolbar.others.share.URLSettingDescription')}
          </p>

          {needEmbedHiddenToolbar && (
            <div className="flex items-center gap-2">
              <Switch
                id="embed-hideToolBar"
                checked={hideToolBar}
                onCheckedChange={(checked) => setHideToolBar(checked)}
              />
              <Label className="text-xs" htmlFor="embed-hideToolBar">
                {t('table:toolbar.others.share.hideToolbar')}
              </Label>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label className="text-xs">{t('common:settings.setting.theme')}</Label>
            <RadioGroup
              className="flex h-5 gap-2"
              defaultValue={shareTheme}
              onValueChange={(e) => setShareTheme(e)}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="system" id="embed-r1" />
                <Label className="text-xs font-normal" htmlFor="embed-r1">
                  {t('common:settings.setting.system')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="light" id="embed-r2" />
                <Label className="text-xs font-normal" htmlFor="embed-r2">
                  {t('common:settings.setting.light')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="dark" id="embed-r3" />
                <Label className="text-xs font-normal" htmlFor="embed-r3">
                  {t('common:settings.setting.dark')}
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const ShareViewContent: React.FC = () => {
  const view = useView();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const permission = useTablePermission();

  const [showPasswordDialog, setShowPasswordDialog] = useState<boolean>();
  const [sharePassword, setSharePassword] = useState<string>('');
  const [shareTheme, setShareTheme] = useState<string>('system');
  const [hideToolBar, setHideToolBar] = useState<boolean>();

  const { mutate: enableShareFn, isPending: enableShareLoading } = useMutation({
    mutationFn: async (view: View) => view.apiEnableShare(),
  });

  const { mutate: disableShareFn, isPending: disableShareLoading } = useMutation({
    mutationFn: async (view: View) => view.disableShare(),
  });

  const shareUrl = useMemo(() => {
    return view?.shareId
      ? getShareUrl({ shareId: view?.shareId, theme: shareTheme, hideToolBar })
      : undefined;
  }, [view?.shareId, shareTheme, hideToolBar]);

  if (!view) {
    return null;
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
    <div className="flex w-full flex-col gap-4 py-4">
      <div className="flex items-center gap-2">
        <Switch
          id="share-view-switch"
          checked={enableShare}
          disabled={enableShareLoading || disableShareLoading || !permission['view|share']}
          onCheckedChange={setEnableShare}
        />
        <Label htmlFor="share-view-switch" className="text-sm">
          {t('table:toolbar.others.share.statusLabel')}
        </Label>
      </div>
      {enableShare ? (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input className="min-w-0 flex-1" id="share-link" value={shareUrl} readOnly />
              <CopyButton
                text={shareUrl as string}
                variant="outline"
                size="icon-sm"
                className="shrink-0"
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon-sm" className="shrink-0">
                    <Qrcode className="size-4 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="size-48 bg-white p-2">
                  {shareUrl && <QRCodeSVG value={shareUrl} className="size-full" />}
                </PopoverContent>
              </Popover>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="shrink-0"
                      onClick={() => view.setRefreshLink()}
                    >
                      <RefreshCcw className="size-4 shrink-0" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{t('table:toolbar.others.share.genLink')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <Separator />

          <div className="flex flex-col gap-3">
            <Label className="text-sm font-medium">{t('table:baseShare.advanced')}</Label>

            {needConfigCopy && (
              <div className="flex items-center gap-2">
                <Switch
                  id="share-view-allowCopy"
                  checked={shareMeta?.allowCopy}
                  onCheckedChange={(checked) => setShareMeta({ allowCopy: checked })}
                />
                <Label className="text-sm font-normal" htmlFor="share-view-allowCopy">
                  {t('table:toolbar.others.share.allowCopy')}
                </Label>
              </div>
            )}
            {needConfigIncludeHiddenField && (
              <div className="flex items-center gap-2">
                <Switch
                  id="share-view-includeHiddenField"
                  checked={shareMeta?.includeHiddenField}
                  onCheckedChange={(checked) => setShareMeta({ includeHiddenField: checked })}
                />
                <Label className="text-sm font-normal" htmlFor="share-view-includeHiddenField">
                  {t('table:toolbar.others.share.showAllFields')}
                </Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id="share-view-password"
                checked={Boolean(shareMeta?.password)}
                onCheckedChange={onPasswordSwitchChange}
              />
              <Label className="text-sm font-normal" htmlFor="share-view-password">
                {t('table:toolbar.others.share.restrict')}
              </Label>
              {Boolean(shareMeta?.password) && (
                <Button
                  className="h-5 px-1 hover:text-muted-foreground"
                  variant="link"
                  size="xs"
                  onClick={() => setShowPasswordDialog(true)}
                >
                  <Edit className="size-3" />
                </Button>
              )}
            </div>
            {shareMeta?.submit && (
              <div className="flex items-center gap-2">
                <Switch
                  id="share-view-required-login"
                  checked={Boolean(shareMeta?.submit?.requireLogin)}
                  onCheckedChange={onSubmitRequireLoginChange}
                />
                <Label className="text-sm font-normal" htmlFor="share-view-required-login">
                  {t('table:toolbar.others.share.requireLogin')}
                </Label>
              </div>
            )}

            {shareUrl && (
              <EmbedConfigPopover
                shareUrl={shareUrl}
                hideToolBar={hideToolBar}
                setHideToolBar={setHideToolBar}
                shareTheme={shareTheme}
                setShareTheme={setShareTheme}
                needEmbedHiddenToolbar={needEmbedHiddenToolbar}
              />
            )}
          </div>
        </>
      ) : null}
      <Dialog
        open={showPasswordDialog}
        onOpenChange={(open) => !open && closeSharePasswordDialog()}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('table:toolbar.others.share.passwordTitle')}</DialogTitle>
          </DialogHeader>
          <Input
            type="password"
            value={sharePassword}
            onChange={(e) => setSharePassword(e.target.value)}
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
