import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateAttachmentId } from '@teable/core';
import { Plus } from '@teable/icons';
import type { ITemplateCoverRo, INotifyVo } from '@teable/openapi';
import { getTemplateByBaseId, publishBase, unpublishTemplate, UploadType } from '@teable/openapi';
import { AttachmentManager } from '@teable/sdk/components';
import { useBase, useSession } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Switch,
  Textarea,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Camera, Send, SmilePlus } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState, useRef, useEffect } from 'react';
import { NodeSelect } from './NodeSelect';
import { NodeTreeSelect } from './NodeTreeSelect';

const attachmentManager = new AttachmentManager(1);

interface IPublishBaseDialogProps {
  children: React.ReactNode;
}

export const PublishBaseDialog = (props: IPublishBaseDialogProps) => {
  const { children } = props;
  const { t } = useTranslation(['space', 'common']);
  const base = useBase();
  const baseId = base?.id;

  const queryClient = useQueryClient();

  const { data: templateDetail } = useQuery({
    queryKey: ['template-by-base', baseId],
    staleTime: 0,
    queryFn: () => getTemplateByBaseId(baseId!).then((res) => res.data),
    onSuccess: (data) => {
      setTitle(data?.name || base?.name || '');
      setDescription(data?.description);
      // only update with server data when no manual upload of image
      if (!uploadedCover) {
        setScreenshotUrl(data?.cover?.presignedUrl || undefined);
      }

      setSelectedNodeIds(data?.publishInfo?.nodes || []);
      setIncludeData(data?.publishInfo?.includeData || false);
      setDefaultActiveNodeId(data?.publishInfo?.defaultActiveNodeId);
    },
  });

  const { mutateAsync: unpublishTemplateMutate, isLoading: unpublishTemplateLoading } = useMutation(
    {
      mutationFn: () => unpublishTemplate(templateDetail?.id as string).then((res) => res.data),
      onSuccess: () => {
        toast.success(t('publishBase.unPublishSuccess'));
        queryClient.invalidateQueries({ queryKey: ['template-by-base', baseId] });
        setTitle('');
        setDescription('');
        setScreenshotUrl(undefined);
        setUploadedCover(null);
      },
    }
  );

  const { mutateAsync: publishBaseMutate, isLoading: publishBaseLoading } = useMutation({
    mutationFn: async ({ title, description }: { title: string; description: string }) => {
      // if user manually uploaded a new image, use the new cover; otherwise use the existing cover
      const cover: ITemplateCoverRo | null = uploadedCover
        ? {
            id: uploadedCover.id,
            name: uploadedCover.name,
            token: uploadedCover.token,
            size: uploadedCover.size,
            url: uploadedCover.url,
            path: uploadedCover.path,
            mimetype: uploadedCover.mimetype,
            width: uploadedCover.width,
            height: uploadedCover.height,
          }
        : templateDetail?.cover || null;

      return publishBase(baseId!, {
        title,
        description,
        cover,
        nodes: selectedNodeIds.length > 0 ? selectedNodeIds : undefined,
        includeData,
        defaultActiveNodeId,
      }).then((res) => res.data);
    },
    onSuccess: () => {
      toast.success(t('publishBase.publishSuccess'));
      queryClient.invalidateQueries({ queryKey: ['template-by-base', baseId] });
      // after publish success, clear the uploaded cover, use server data next time
      setUploadedCover(null);
    },
  });

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(base?.name || '');
  const [description, setDescription] = useState<string | undefined>('');
  const [screenshotUrl, setScreenshotUrl] = useState<string | undefined>();
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedCover, setUploadedCover] = useState<
    | (INotifyVo & {
        id: string;
        name: string;
      })
    | null
  >(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [includeData, setIncludeData] = useState(false);
  const [defaultActiveNodeId, setDefaultActiveNodeId] = useState<string | null | undefined>(null);
  const { user } = useSession();
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      // when dialog is closed, reset upload state
      setUploadedCover(null);
      setUploadProgress(0);
      setIsUploading(false);
    }
  }, [open]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    // validate file type
    if (!file.type.startsWith('image/')) {
      toast.error(t('publishBase.invalidImageType'));
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const attachmentId = generateAttachmentId();
    const fileName = file.name;

    attachmentManager.upload(
      [{ id: attachmentId, instance: file }],
      UploadType.Table,
      {
        successCallback: (_, result: INotifyVo) => {
          setScreenshotUrl(result.presignedUrl);
          setUploadedCover({
            ...result,
            id: attachmentId,
            name: fileName,
          });
          setIsUploading(false);
          toast.success(t('publishBase.uploadSuccess'));
        },
        errorCallback: (_, error) => {
          setIsUploading(false);
          toast.error(error || t('publishBase.uploadFailed'));
        },
        progressCallback: (_, progress) => {
          setUploadProgress(progress);
        },
      },
      baseId
    );
  };

  const handleUploadClick = () => {
    if (uploadRef.current) {
      uploadRef.current.value = '';
      uploadRef.current.click();
    }
  };

  useEffect(() => {
    if (defaultActiveNodeId && !selectedNodeIds.includes(defaultActiveNodeId)) {
      setDefaultActiveNodeId(null);
    }
  }, [selectedNodeIds, defaultActiveNodeId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-[960px] gap-0">
        <DialogHeader className="h-20">
          <DialogTitle>{t('publishBase.title')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t('publishBase.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex w-full gap-10 overflow-x-hidden">
          <div className="relative flex min-w-[358px] flex-1 flex-col gap-6 px-0.5">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-semibold">{t('publishBase.infoTitle')}</div>
              <div className="flex flex-col gap-2">
                <span className="text-sm">{t('publishBase.form.title')}</span>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('publishBase.form.titlePlaceholder')}
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm">{t('publishBase.form.description')}</span>
                <Textarea
                  className="min-h-12 resize-y"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('publishBase.form.descriptionPlaceholder')}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">{t('publishBase.form.publishNode')}</span>
              </div>
              <NodeTreeSelect
                showCheckbox
                checkedItems={selectedNodeIds}
                onCheckedItemsChange={(ids) => setSelectedNodeIds(ids)}
                placeholder={t('common:actions.select')}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm">{t('publishBase.form.security')}</span>
              <div className="flex items-center space-x-2">
                <Switch id="include-data" checked={includeData} onCheckedChange={setIncludeData} />
                <Label htmlFor="include-data">{t('publishBase.form.includeData')}</Label>
                {/* <QuestionMarkCircledIcon className="size-4" /> */}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">{t('publishBase.form.advanced')}</span>
              <span className="text-sm">{t('publishBase.form.defaultActiveNode')}</span>
              <NodeSelect
                nodeIds={selectedNodeIds}
                value={defaultActiveNodeId || ''}
                onChange={setDefaultActiveNodeId}
              />
            </div>

            <div className="absolute inset-x-0 bottom-0 flex w-full gap-1">
              {templateDetail && (
                <Button
                  className="flex w-full items-center gap-2"
                  variant="outline"
                  onClick={() => unpublishTemplateMutate()}
                  disabled={unpublishTemplateLoading}
                >
                  {t('publishBase.unPublish')}
                  {unpublishTemplateLoading && <Spin className="size-4" />}
                </Button>
              )}
              <Button
                className="flex w-full items-center gap-2"
                onClick={() => publishBaseMutate({ title, description: description || '' })}
                disabled={publishBaseLoading}
              >
                <Send className="size-4" />
                {templateDetail ? t('publishBase.update') : t('publishBase.publish')}

                {publishBaseLoading && <Spin className="size-4" />}
              </Button>
            </div>
          </div>

          <div className="relative h-[520px] w-[512px] shrink-0 overflow-hidden rounded-lg border bg-muted">
            <input
              ref={uploadRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
            <div className="relative flex size-full flex-col items-center justify-center gap-3 p-5">
              <div className="text-base font-semibold">{t('publishBase.previewTips')}</div>

              <div className="flex min-h-[302px] w-[432px] flex-col overflow-hidden rounded-md border shadow-md">
                <div
                  className="group relative h-[180px] cursor-pointer overflow-hidden"
                  onClick={handleUploadClick}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleUploadClick();
                    }
                  }}
                >
                  {screenshotUrl ? (
                    <>
                      <img
                        src={screenshotUrl}
                        className="size-full object-cover"
                        alt="published base preview"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                        <div className="flex flex-col items-center gap-2">
                          <Camera className="size-8 text-white" />
                          <span className="text-sm text-white">{t('publishBase.changeCover')}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-4 bg-muted transition-colors hover:bg-muted/80">
                      {isUploading ? (
                        <>
                          <Spin className="size-12" />
                          <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
                        </>
                      ) : (
                        <>
                          <Plus className="size-12 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            {t('publishBase.uploadCover')}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 border-t bg-card p-4">
                  <p
                    className={cn(
                      'text-sm font-semibold',
                      title ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {title || t('publishBase.form.toBeFilled')}
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Avatar className="size-5">
                        <AvatarImage src={user?.avatar || ''} />
                        <AvatarFallback>{user?.name?.slice(0, 1)}</AvatarFallback>
                      </Avatar>
                      <p className="text-sm text-muted-foreground">{user?.name}</p>
                    </div>

                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <SmilePlus className="size-4" />
                      {t('publishBase.usageCount')}
                      {templateDetail?.usageCount || 0}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'line-clamp-3 text-wrap break-words text-sm',
                      description ? 'text-foreground' : 'text-muted-foreground'
                    )}
                    title={description}
                  >
                    {description || t('publishBase.form.toBeFilled')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
