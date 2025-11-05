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
import { FilePreviewProvider, Progress, ScrollArea, cn, isImage, sonner } from '@teable/ui-lib';
import { map, omit } from 'lodash';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import { useBaseId } from '../../../../hooks';
import { UsageLimitModalType, useUsageLimitModalStore } from '../../../billing/store';
import { useAttachmentPreviewI18Map } from '../../../hooks';
import { EllipsisFileName } from '../../../upload/EllipsisFileName';
import { FileCover } from '../../../upload/FileCover';
import { FileZone } from '../../../upload/FileZone';
import { getFileCover } from '../utils';
import AttachmentItem from './AttachmentItem';
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

type IUploadFileMap = { [key: string]: { progress: number; file: File } };

const defaultAttachmentManager = new AttachmentManager(2);

export interface IUploadAttachmentRef {
  uploadAttachment: (files: File[]) => void;
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
    const [sortData, setSortData] = useState([...attachments]);
    const [uploadingFiles, setUploadingFiles] = useState<IUploadFileMap>({});
    const listRef = useRef<HTMLDivElement>(null);
    const attachmentsRef = useRef<IAttachmentCellValue>(attachments);
    const [newAttachments, setNewAttachments] = useState<IAttachmentCellValue>([]);
    const { t } = useTranslation();
    const i18nMap = useAttachmentPreviewI18Map();
    const fileInput = useRef<HTMLInputElement>(null);
    const sensors = useSensors(
      useSensor(PointerSensor, {
        activationConstraint: { distance: 5 },
      }),
      useSensor(KeyboardSensor, {
        coordinateGetter: sortableKeyboardCoordinates,
      })
    );

    attachmentsRef.current = attachments;

    useEffect(() => {
      if (newAttachments.length && newAttachments.length === Object.keys(uploadingFiles).length) {
        onChange?.(attachmentsRef.current.concat(newAttachments));
        setNewAttachments([]);
        requestAnimationFrame(() => {
          setUploadingFiles({});
        });
      }
    }, [newAttachments, onChange, uploadingFiles]);

    const onDelete = (id: string) => {
      const finalAttachments = attachments.filter((attachment) => attachment.id !== id);
      onChange?.(!finalAttachments.length ? null : finalAttachments);
    };

    const downloadFile = ({ presignedUrl, name }: IAttachmentItem) => {
      const downloadLink = document.createElement('a');
      downloadLink.href = presignedUrl || '';
      downloadLink.target = '_blank';
      downloadLink.download = name;
      downloadLink.click();
    };

    const handleSuccess = useCallback((file: IFile, attachment: INotifyVo) => {
      const { id, instance } = file;
      const newAttachment: IAttachmentItem = {
        id,
        name: instance.name,
        ...omit(attachment, ['url']),
      };
      setNewAttachments((pre) => [...pre, newAttachment]);
    }, []);

    const uploadAttachment = useCallback(
      (files: File[]) => {
        const uploadList = files.map((v) => ({ instance: v, id: generateAttachmentId() }));

        const newUploadMap = uploadList.reduce((acc: IUploadFileMap, file) => {
          acc[file.id] = { progress: 0, file: file.instance };
          return acc;
        }, {});
        attachmentManager.upload(
          uploadList,
          UploadType.Table,
          {
            successCallback: handleSuccess,
            errorCallback: (file, error, code) => {
              const curUploadingFiles = { ...uploadingFiles };
              delete curUploadingFiles[file.id];
              setUploadingFiles(curUploadingFiles);

              if (code === 402) {
                return useUsageLimitModalStore.setState({
                  modalType: UsageLimitModalType.Upgrade,
                  modalOpen: true,
                });
              }
              toast.error(error ?? t('common.uploadFailed'));
            },
            progressCallback: (file, progress) => {
              setUploadingFiles((pre) => ({
                ...pre,
                [file.id]: { progress, file: file.instance },
              }));
            },
          },
          baseId
        );
        setUploadingFiles((pre) => ({ ...pre, ...newUploadMap }));
        setTimeout(() => {
          scrollBottom();
        }, 100);
      },
      [attachmentManager, baseId, handleSuccess, t, uploadingFiles]
    );

    const scrollBottom = () => {
      const lastChild = listRef.current?.lastElementChild;
      if (lastChild) {
        lastChild.scrollTo({
          top: lastChild.scrollHeight,
          behavior: 'smooth',
        });
      }
    };

    const len = useMemo(() => {
      return attachments.length + Object.keys(uploadingFiles).length;
    }, [attachments, uploadingFiles]);

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

    const uploadingFilesList = map(uploadingFiles, (value, key) => ({ id: key, ...value }));

    const handleDragEnd = (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        setSortData((sortData) => {
          const oldIndex = sortData.findIndex((item) => item.id === active.id);
          const newIndex = sortData.findIndex((item) => item.id === over.id);

          if (oldIndex !== -1 && newIndex !== -1) {
            onChange?.(arrayMove(sortData, oldIndex, newIndex));
            return arrayMove(sortData, oldIndex, newIndex);
          }
          return sortData;
        });
      }
    };

    useEffect(() => {
      if (attachments && attachments.length) {
        setSortData([...attachments]);
      }
    }, [attachments]);

    useImperativeHandle<IUploadAttachmentRef, IUploadAttachmentRef>(ref, () => ({
      uploadAttachment,
    }));

    const handleSelectFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      fileList && uploadAttachment(Array.from(fileList));
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
              'h-[120px]': len === 0,
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
            {len > 0 && (
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
                  {uploadingFilesList.map(({ id, progress, file }) => (
                    <li key={id} className="flex h-[132px] w-[104px] flex-col rounded-lg p-1">
                      <div className="relative flex-1 overflow-hidden rounded-lg">
                        <div className="absolute inset-0">
                          <FileCover
                            className="size-full object-cover"
                            mimetype={file.type}
                            url={isImage(file.type) ? URL.createObjectURL(file) : undefined}
                            name={file.name}
                          />
                        </div>
                        <div className="absolute inset-0 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-border bg-foreground/50 px-4 text-background">
                          <Progress indicatorClassName="bg-background" value={progress} />
                          {progress}%
                        </div>
                      </div>
                      <EllipsisFileName name={file.name} endLength={3} />
                    </li>
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
