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
import { generateAttachmentId } from '@teable/core';
import { useTheme } from '@teable/next-themes';
import { UploadType, type INotifyVo } from '@teable/openapi';
import { FilePreviewProvider, ScrollArea, cn, sonner } from '@teable/ui-lib';
import { omit } from 'lodash';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import { useBaseId, useIsMobile } from '../../../../hooks';
import { UsageLimitModalType, useUsageLimitModalStore } from '../../../billing/store';
import { useAttachmentPreviewI18Map } from '../../../hooks';
import { FileZone } from '../../../upload/FileZone';
import { getFileCover } from '../utils';
import AttachmentItem from './AttachmentItem';
import { UploadingFile } from './UploadingFile';
import type { IFile } from './uploadManage';
import { AttachmentManager } from './uploadManage';

const { toast } = sonner;

export interface IUploadAttachment {
  className?: string;
  attachments: IAttachmentCellValue;
  attachmentManager?: AttachmentManager;
  onChange?: (attachment: IAttachmentCellValue | null) => void;
  readonly?: boolean;
  disabled?: boolean;
}

// Unified uploading file state
interface IUploadingFile {
  id: string;
  file: File;
  progress: number;
}

const defaultAttachmentManager = new AttachmentManager(2);

export interface IUploadAttachmentRef {
  uploadAttachment: (files: File[]) => void;
  setUploadingFiles: (files: IUploadingFile[]) => void;
}

export const UploadAttachment = forwardRef<IUploadAttachmentRef, IUploadAttachment>(
  (props, ref) => {
    const {
      className,
      attachments,
      onChange,
      readonly,
      disabled,
      attachmentManager = defaultAttachmentManager,
    } = props;
    const { resolvedTheme } = useTheme();
    const baseId = useBaseId();
    const [uploadingFiles, setUploadingFiles] = useState<IUploadingFile[]>([]);
    const listRef = useRef<HTMLDivElement>(null);
    const attachmentsRef = useRef(attachments);
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

    // Keep attachmentsRef in sync
    attachmentsRef.current = attachments;

    // Local state for sortData to enable optimistic updates
    const [sortData, setSortData] = useState<IAttachmentCellValue>(attachments);

    // Sync sortData when attachments prop changes
    useEffect(() => {
      setSortData(attachments);
    }, [attachments]);

    const onDelete = (id: string) => {
      // Optimistic update: immediately update local state
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

    const uploadAttachment = useCallback(
      (files: File[]) => {
        if (files.length === 0) return;

        const uploadList = files.map((file) => ({
          instance: file,
          id: generateAttachmentId(),
        }));

        // Add to uploading list
        const newUploadingFiles: IUploadingFile[] = uploadList.map(({ id, instance }) => ({
          id,
          file: instance,
          progress: 0,
        }));

        setUploadingFiles((prev) => [...prev, ...newUploadingFiles]);

        // Track completed attachments for this batch
        const batchResult = {
          completed: [] as IAttachmentItem[],
          pending: uploadList.length,
        };
        const commitBatch = () => {
          if (batchResult.completed.length > 0) {
            onChange?.([
              ...attachmentsRef.current,
              ...batchResult.completed.sort(
                (a, b) =>
                  uploadList.findIndex((item) => item.id === a.id) -
                  uploadList.findIndex((item) => item.id === b.id)
              ),
            ]);
            batchResult.completed = [];
          }
        };

        const handleSuccess = (file: IFile, attachment: INotifyVo) => {
          const { id, instance } = file;
          const newAttachment: IAttachmentItem = {
            id,
            name: instance.name,
            ...omit(attachment, ['url']),
          };

          batchResult.completed.push(newAttachment);
          batchResult.pending--;

          // Remove from uploading list
          setUploadingFiles((prev) => prev.filter((item) => item.id !== id));

          if (batchResult.pending === 0) {
            commitBatch();
          }
        };

        const handleError = (file: IFile, error?: string, code?: number) => {
          batchResult.pending--;

          // Remove from uploading list on error
          setUploadingFiles((prev) => prev.filter((item) => item.id !== file.id));

          if (code === 402) {
            useUsageLimitModalStore.setState({
              modalType: UsageLimitModalType.Upgrade,
              modalOpen: true,
            });
          } else {
            toast.error(error ?? t('common.uploadFailed'));
          }

          // Commit when all files are processed (even if some failed)
          if (batchResult.pending === 0) {
            commitBatch();
          }
        };

        attachmentManager.upload(
          uploadList,
          UploadType.Table,
          {
            successCallback: handleSuccess,
            errorCallback: handleError,
            progressCallback: (file, progress) => {
              setUploadingFiles((prev) =>
                prev.map((item) => (item.id === file.id ? { ...item, progress } : item))
              );
            },
          },
          baseId
        );

        // Auto scroll to bottom after files added
        setTimeout(() => {
          scrollBottom();
        }, 100);
      },
      [attachmentManager, baseId, onChange, scrollBottom, t]
    );

    // Total count of attachments and uploading files
    const totalCount = attachments.length + uploadingFiles.length;

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
              // Optimistic update: update local state immediately
              // Then notify parent
              onChange?.(newSortedData);
              return newSortedData;
            }
            return currentSortData;
          });
        }
      },
      [onChange]
    );

    useImperativeHandle(ref, () => ({
      uploadAttachment,
      setUploadingFiles: (tasks: IUploadingFile[]) => {
        setUploadingFiles(tasks);
      },
    }));

    const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (fileList) {
        uploadAttachment(Array.from(fileList));
      }
      e.target.value = '';
    };

    return (
      <div className={cn('flex h-full flex-col overflow-hidden p-4', className)}>
        <div className="relative flex-1 overflow-hidden">
          <FileZone
            action={['drop', 'paste']}
            disabled={disabled || readonly}
            onChange={uploadAttachment}
            zoneClassName={cn('h-12 cursor-default', {
              'h-[120px]': totalCount === 0,
            })}
            className="min-h-[auto]"
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
                    <UploadingFile key={id} file={file} progress={progress} />
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

UploadAttachment.displayName = 'UploadAttachment';

export default UploadAttachment;
