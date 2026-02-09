import type { IFieldVo } from '@teable/core';
import { HelpCircle, ChevronDown, ChevronRight, Check } from '@teable/icons';
import type { IGetRecordsRo } from '@teable/openapi';
import { useFields, useFieldStaticGetter } from '@teable/sdk';
import {
  Button,
  Checkbox,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import type { IAttachmentPreview, IDownloadProgress } from '../../utils/download-all-attachments';
import {
  downloadAllAttachments,
  formatFileSize,
  getAttachmentPreview,
  isFieldSuitableForNaming,
} from '../../utils/download-all-attachments';
import { DownloadProgressToast } from '../DownloadProgressToast';
import { useColumnDownloadDialogStore } from './useDownloadAttachmentsStore';

interface IDownloadContentProps {
  tableId: string;
  fieldId: string;
  fieldName: string;
  viewId?: string;
  shareId?: string;
  personalViewCommonQuery?: IGetRecordsRo;
  onClose: () => void;
}

export const DownloadContent = ({
  tableId,
  fieldId,
  fieldName,
  viewId,
  shareId,
  personalViewCommonQuery,
  onClose,
}: IDownloadContentProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<IAttachmentPreview | null>(null);
  const [downloading, setDownloading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { namingFieldId, setNamingFieldId, groupByRow, setGroupByRow } =
    useColumnDownloadDialogStore();
  const allFields = useFields({ withHidden: true, withDenied: true });
  const fieldStaticGetter = useFieldStaticGetter();
  const [selectorOpen, setSelectorOpen] = useState(false);

  // Filter fields suitable for naming (text-based fields)
  const namingFields = useMemo(() => {
    return allFields.filter((field) => isFieldSuitableForNaming(field as unknown as IFieldVo));
  }, [allFields]);

  // Get the selected naming field instance for download
  // When namingFieldId is undefined, return undefined (use row number prefix)
  const namingField = useMemo(() => {
    if (!namingFieldId) return undefined;
    return allFields.find((f) => f.id === namingFieldId);
  }, [namingFieldId, allFields]);

  // Handle field selection - toggle if clicking the same field (deselect)
  const handleFieldSelect = useCallback(
    (selectedValue: string) => {
      setSelectorOpen(false);
      if (selectedValue === namingFieldId) {
        // Deselect if clicking the same field
        setNamingFieldId(undefined);
      } else {
        setNamingFieldId(selectedValue);
      }
    },
    [namingFieldId, setNamingFieldId]
  );

  // Load preview on mount
  useEffect(() => {
    const loadPreview = async () => {
      try {
        const previewData = await getAttachmentPreview(
          tableId,
          fieldId,
          viewId,
          shareId,
          personalViewCommonQuery
        );
        setPreview(previewData);
      } catch (error) {
        console.error('Failed to load preview:', error);
        onClose();
        toast.error(t('table:download.allAttachments.error'));
      } finally {
        setLoading(false);
      }
    };

    loadPreview();
  }, [tableId, fieldId, viewId, shareId, personalViewCommonQuery, onClose, t]);

  const handleStartDownload = useCallback(async () => {
    if (!preview || preview.totalAttachments === 0) return;

    // Check if Service Worker is available (requires HTTPS or localhost)
    if (typeof window !== 'undefined' && !navigator.serviceWorker) {
      toast.error(t('table:download.allAttachments.requireHttps'));
      return;
    }

    setDownloading(true);
    onClose();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const toastId = toast.custom(
      () => (
        <DownloadProgressToast
          progress={{ downloaded: 0, total: 0, currentFileName: '', percent: 0 }}
          onCancel={() => {
            abortController.abort();
            toast.dismiss(toastId);
          }}
        />
      ),
      { duration: Infinity, unstyled: true, classNames: { toast: 'bg-transparent shadow-none' } }
    );

    const updateProgress = (progress: IDownloadProgress) => {
      toast.custom(
        () => (
          <DownloadProgressToast
            progress={progress}
            onCancel={() => {
              abortController.abort();
              toast.dismiss(toastId);
            }}
          />
        ),
        {
          id: toastId,
          duration: Infinity,
          unstyled: true,
          classNames: { toast: 'bg-transparent shadow-none border rounded-lg' },
        }
      );
    };

    try {
      updateProgress({
        downloaded: 0,
        total: preview.totalSize,
        currentFileName: '',
        percent: 0,
      });

      const result = await downloadAllAttachments({
        tableId,
        fieldId,
        fieldName,
        viewId,
        shareId,
        personalViewCommonQuery,
        namingField,
        groupByRow,
        abortController,
        onProgress: updateProgress,
      });

      toast.dismiss(toastId);

      if (result.cancelled) {
        toast.info(t('table:download.allAttachments.cancelled'));
      } else if (result.success) {
        toast.success(t('table:download.allAttachments.completed'));
      } else if (result.failedFiles.length > 0) {
        toast.warning(
          t('table:download.allAttachments.errorPartial', {
            failedCount: result.failedFiles.length,
          })
        );
      }
    } catch (error) {
      toast.dismiss(toastId);
      console.error('Download failed:', error);
      toast.error(t('table:download.allAttachments.error'));
    } finally {
      setDownloading(false);
      abortControllerRef.current = null;
    }
  }, [
    preview,
    tableId,
    fieldId,
    fieldName,
    viewId,
    shareId,
    namingField,
    groupByRow,
    personalViewCommonQuery,
    onClose,
    t,
  ]);

  if (loading) {
    return (
      <>
        <div className="flex flex-col gap-3 py-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('table:download.allAttachments.cancel')}
          </Button>
          <Button disabled>{t('table:download.allAttachments.startDownload')}</Button>
        </div>
      </>
    );
  }

  if (!preview || preview.totalAttachments === 0) {
    return (
      <>
        <div className="py-4">
          <p className="text-muted-foreground">
            {t('table:download.allAttachments.noAttachments')}
          </p>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('table:download.allAttachments.cancel')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 py-4">
        <p className="text-sm">
          {t('table:download.allAttachments.rowsWithAttachments', {
            count: preview.rowsWithAttachments,
          })}
        </p>
        <p className="text-sm">
          {t('table:download.allAttachments.totalAttachments', {
            count: preview.totalAttachments,
          })}
        </p>
        <p className="text-sm font-medium">
          {t('table:download.allAttachments.totalSize', {
            size: formatFileSize(preview.totalSize),
          })}
        </p>

        {/* Advanced options */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            {t('table:download.allAttachments.advancedOptions')}
            <ChevronRight className="size-4 transition-transform duration-200 [[data-state=open]>&]:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {/* Naming field selector */}
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">
                {t('table:download.allAttachments.namingFieldLabel')}
              </Label>
              <Popover open={selectorOpen} onOpenChange={setSelectorOpen} modal>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={selectorOpen}
                    className="w-full justify-between dark:bg-[color-mix(in_oklab,white_10%,hsl(var(--background)))]"
                  >
                    <div className="flex items-center gap-2 truncate">
                      {namingFieldId ? (
                        (() => {
                          const selectedField = namingFields.find((f) => f.id === namingFieldId);
                          if (!selectedField) return null;
                          const { Icon } = fieldStaticGetter(selectedField.type, {
                            isLookup: selectedField.isLookup,
                            isConditionalLookup: selectedField.isConditionalLookup,
                            hasAiConfig: Boolean(selectedField.aiConfig),
                            deniedReadRecord: !selectedField.canReadFieldRecord,
                          });
                          return (
                            <>
                              <Icon className="size-4 shrink-0" />
                              <span className="truncate">{selectedField.name}</span>
                            </>
                          );
                        })()
                      ) : (
                        <span className="text-muted-foreground">
                          {t('table:download.allAttachments.selectField')}
                        </span>
                      )}
                    </div>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0">
                  <Command>
                    <CommandInput placeholder={t('common:actions.search')} />
                    <CommandList className="max-h-60">
                      <CommandEmpty>{t('common:noResult')}</CommandEmpty>
                      <CommandGroup>
                        {namingFields.map((field) => {
                          const { Icon } = fieldStaticGetter(field.type, {
                            isLookup: field.isLookup,
                            isConditionalLookup: field.isConditionalLookup,
                            hasAiConfig: Boolean(field.aiConfig),
                            deniedReadRecord: !field.canReadFieldRecord,
                          });
                          return (
                            <CommandItem
                              key={field.id}
                              value={field.id}
                              keywords={[field.name]}
                              onSelect={() => handleFieldSelect(field.id)}
                            >
                              <Icon className="mr-2 size-4" />
                              <span className="truncate">{field.name}</span>
                              <Check
                                className={cn(
                                  'ml-auto size-4',
                                  namingFieldId === field.id ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Group by row option */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="groupByRow"
                checked={groupByRow}
                onCheckedChange={(checked) => setGroupByRow(checked === true)}
              />
              <Label htmlFor="groupByRow" className="cursor-pointer text-sm">
                {t('table:download.allAttachments.groupByRow')}
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="size-4 cursor-pointer text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={5}>
                    <p className="max-w-xs">{t('table:download.allAttachments.groupByRowTip')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={downloading}>
          {t('table:download.allAttachments.cancel')}
        </Button>
        <Button onClick={handleStartDownload} disabled={downloading}>
          {t('table:download.allAttachments.startDownload')}
        </Button>
      </div>
    </>
  );
};
