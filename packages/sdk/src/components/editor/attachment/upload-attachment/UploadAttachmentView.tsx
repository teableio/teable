import type { DragEndEvent } from '@dnd-kit/core';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import type { IAttachmentItem, IAttachmentCellValue } from '@teable/core';
import { useTheme } from '@teable/next-themes';
import { Button, FilePreviewProvider, ScrollArea, cn } from '@teable/ui-lib';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import { useIsMobile } from '../../../../hooks';
import { useDownloadAttachmentsStore } from '../../../../store';
import { useAttachmentPreviewI18Map } from '../../../hooks';
import { FileZone } from '../../../upload/FileZone';
import { getFileCover } from '../utils';
import AttachmentItem from './AttachmentItem';
import type { UploadAttachmentViewProps, UploadAttachmentViewRef } from './types';
import { UploadingFile } from './UploadingFile';

export const UploadAttachmentView = forwardRef<UploadAttachmentViewRef, UploadAttachmentViewProps>(
  (props, ref) => {
    const {
      className,
      attachments,
      uploadingFiles,
      onChange,
      showDownloadAll,
      readonly,
      disabled,
      onUpload,
      onCancelUpload,
    } = props;
    const triggerCellDownload = useDownloadAttachmentsStore((state) => state.triggerCellDownload);
    const { resolvedTheme } = useTheme();
    const [sortData, setSortData] = useState<IAttachmentCellValue>(attachments);
    const listRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    const i18nMap = useAttachmentPreviewI18Map();
    const fileInput = useRef<HTMLInputElement>(null);
    const isMobile = useIsMobile();
    const sensors = useSensors(
      useSensor(PointerSensor, {
        activationConstraint: { distance: 5 },
      }),
      useSensor(KeyboardSensor, {
        coordinateGetter: sortableKeyboardCoordinates,
      })
    );

    useEffect(() => {
      setSortData(attachments);
    }, [attachments]);

    const onDelete = (id: string) => {
      setSortData((prev) => {
        const finalAttachments = prev.filter((attachment) => attachment.id !== id);
        onChange?.(!finalAttachments.length ? null : finalAttachments);
        return finalAttachments;
      });
    };

    const downloadFile = useCallback(
      ({ presignedUrl, name }: IAttachmentItem) => {
        const downloadLink = document.createElement('a');
        downloadLink.href = presignedUrl || '';
        downloadLink.target = isMobile ? '_self' : '_blank';
        downloadLink.download = name;
        downloadLink.click();
      },
      [isMobile]
    );

    const scrollBottom = useCallback(() => {
      const lastChild = listRef.current?.lastElementChild;
      if (lastChild) {
        lastChild.scrollTo({
          top: lastChild.scrollHeight,
          behavior: 'smooth',
        });
      }
    }, []);

    const scheduleScrollBottom = useCallback(() => {
      setTimeout(() => {
        scrollBottom();
      }, 100);
    }, [scrollBottom]);

    useImperativeHandle(ref, () => ({
      scrollToBottom: scheduleScrollBottom,
    }));

    const handleUpload = useCallback(
      (files: File[]) => {
        onUpload(files);
        scheduleScrollBottom();
      },
      [onUpload, scheduleScrollBottom]
    );

    const fileCover = useCallback(
      ({
        mimetype,
        presignedUrl,
        lgThumbnailUrl,
      }: Pick<IAttachmentItem, 'mimetype' | 'presignedUrl' | 'lgThumbnailUrl'>) => {
        if (!presignedUrl) return '';
        return (
          lgThumbnailUrl ?? getFileCover(mimetype, presignedUrl, resolvedTheme as 'light' | 'dark')
        );
      },
      [resolvedTheme]
    );

    const handleDragEnd = useCallback(
      (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
          setSortData((currentSortData) => {
            const oldIndex = currentSortData.findIndex((item) => item.id === active.id);
            const newIndex = currentSortData.findIndex((item) => item.id === over.id);

            if (oldIndex !== -1 && newIndex !== -1) {
              const newSortedData = arrayMove(currentSortData, oldIndex, newIndex);
              onChange?.(newSortedData);
              return newSortedData;
            }
            return currentSortData;
          });
        }
      },
      [onChange]
    );

    const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (fileList) {
        handleUpload(Array.from(fileList));
      }
      e.target.value = '';
    };

    const totalCount = attachments.length + uploadingFiles.length;

    return (
      <div className={cn('flex h-full flex-col overflow-hidden p-4', className)}>
        {attachments.length > 0 && showDownloadAll && (
          <div className="absolute bottom-0 right-0 z-10">
            <Button
              className="font-normal opacity-50"
              variant="link"
              size={'sm'}
              onClick={() => triggerCellDownload(attachments, 'attachments.zip')}
            >
              {t('editor.attachment.downloadAll')}
            </Button>
          </div>
        )}
        <div className="relative flex flex-1 overflow-hidden">
          <FileZone
            action={['drop', 'paste']}
            disabled={disabled || readonly}
            onChange={handleUpload}
            zoneClassName={cn('h-12 cursor-default', {
              'h-[120px]': totalCount === 0,
            })}
            className="size-auto min-h-0 flex-1"
            defaultText={
              <div className="flex items-center justify-center">
                <p className="text-sm">
                  <button
                    className="text-sm text-blue-500"
                    onClick={() => fileInput.current?.click()}
                  >
                    {t('editor.attachment.uploadBaseTextPrefix')}
                  </button>
                  {t('editor.attachment.uploadBaseText')}
                </p>
              </div>
            }
          >
            <input
              type="file"
              className="hidden"
              multiple
              ref={fileInput}
              onChange={handleSelectFiles}
            />
            {totalCount > 0 && (
              <ScrollArea className="h-full flex-1" ref={listRef}>
                <ul className="-right-2 flex size-full flex-wrap gap-1 gap-y-2 overflow-hidden">
                  <FilePreviewProvider i18nMap={i18nMap}>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={sortData}
                        disabled={readonly}
                        strategy={rectSortingStrategy}
                      >
                        {sortData.map((attachment) => (
                          <AttachmentItem
                            key={attachment.id}
                            attachment={attachment}
                            onDelete={onDelete}
                            downloadFile={downloadFile}
                            fileCover={fileCover}
                            readonly={readonly}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  </FilePreviewProvider>
                  {uploadingFiles.map(({ id, progress, file }) => (
                    <UploadingFile
                      key={id}
                      file={file}
                      progress={progress}
                      onCancel={onCancelUpload ? () => onCancelUpload(id) : undefined}
                    />
                  ))}
                </ul>
              </ScrollArea>
            )}
          </FileZone>
        </div>
      </div>
    );
  }
);

UploadAttachmentView.displayName = 'UploadAttachmentView';
