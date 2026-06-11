import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IAttachmentItem } from '@teable/core';
import { Download, X } from '@teable/icons';
import { Button, cn, FilePreviewItem, isImage } from '@teable/ui-lib';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EllipsisFileName } from '../../../upload/EllipsisFileName';
import { FileCover } from '../../../upload/FileCover';
import { formatFileSize, isSystemFileIcon } from '../utils';

interface IUploadAttachment {
  attachment: IAttachmentItem;
  readonly?: boolean;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  fileCover: (data: IAttachmentItem) => string;
  downloadFile: (data: IAttachmentItem) => void;
}

function AttachmentItem(props: IUploadAttachment) {
  const { attachment, onDelete, onRename, fileCover, downloadFile, readonly } = props;
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: attachment.id,
    disabled: readonly || isEditing,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleStartEdit = useCallback(() => {
    if (readonly) return;
    setIsEditing(true);
  }, [readonly]);

  const handleCommit = useCallback(() => {
    const value = inputRef.current?.value.trim();
    setIsEditing(false);
    if (value && value !== attachment.name) {
      onRename(attachment.id, value);
    }
  }, [attachment.id, attachment.name, onRename]);

  const handleCancel = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = attachment.name;
    }
    setIsEditing(false);
  }, [attachment.name]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.value = attachment.name;
      inputRef.current.focus();
      const lastDot = attachment.name.lastIndexOf('.');
      const selectEnd = lastDot > 0 ? lastDot : attachment.name.length;
      inputRef.current.setSelectionRange(0, selectEnd);
    }
  }, [isEditing, attachment.name]);

  const previewUrl = fileCover(attachment) || attachment.presignedUrl;
  const shouldRenderPreviewImage = Boolean(
    previewUrl && (isImage(attachment.mimetype) || attachment.lgThumbnailUrl)
  );

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <li
        key={attachment.id}
        className="flex h-[132px] w-[104px] flex-col rounded-lg p-1 hover:bg-accent"
      >
        <div
          className={cn(
            'group relative flex-1 cursor-pointer overflow-hidden rounded-lg border border-border',
            {
              'border-none': isSystemFileIcon(attachment.mimetype) && !attachment.lgThumbnailUrl,
            }
          )}
        >
          <FilePreviewItem
            className="flex items-center justify-center text-[0px]"
            src={attachment.presignedUrl || ''}
            name={attachment.name}
            mimetype={attachment.mimetype}
            size={attachment.size}
          >
            {shouldRenderPreviewImage ? (
              <img className="size-full object-cover" src={previewUrl} alt={attachment.name} />
            ) : (
              <FileCover
                className="size-full object-cover"
                mimetype={attachment.mimetype}
                url={previewUrl}
                name={attachment.name}
              />
            )}
          </FilePreviewItem>
          <div className="absolute inset-x-0 top-0 z-10 hidden items-center gap-1 rounded-t-lg bg-black/60 px-1.5 py-1 text-white group-hover:flex">
            <span
              className="mr-auto min-w-0 truncate text-xs"
              title={formatFileSize(attachment.size)}
            >
              {formatFileSize(attachment.size)}
            </span>
            <Button
              variant={'ghost'}
              className="size-auto shrink-0 p-0 text-white hover:bg-white/20 hover:text-white focus-visible:ring-transparent focus-visible:ring-offset-0"
              onClick={(e) => {
                e.stopPropagation();
                downloadFile(attachment);
              }}
            >
              <Download className="size-4 shrink-0" />
            </Button>
            {!readonly && (
              <Button
                variant={'ghost'}
                className="size-auto shrink-0 p-0 text-white hover:bg-white/20 hover:text-white focus-visible:ring-transparent focus-visible:ring-offset-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(attachment.id);
                }}
              >
                <X className="size-4 shrink-0" />
              </Button>
            )}
          </div>
        </div>
        {isEditing ? (
          <input
            ref={inputRef}
            className="mt-2 w-full rounded border border-input bg-background px-1 text-[11px] leading-5 outline-none"
            onBlur={handleCommit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                inputRef.current?.blur();
              } else if (e.key === 'Escape') {
                handleCancel();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            className={cn('w-full border border-transparent', !readonly && 'cursor-text')}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleStartEdit();
            }}
            onPointerDown={(e) => {
              if (!readonly) e.stopPropagation();
            }}
            onMouseDown={(e) => {
              if (!readonly) e.stopPropagation();
            }}
          >
            <EllipsisFileName className="mt-2" name={attachment.name} />
          </button>
        )}
      </li>
    </div>
  );
}

export default AttachmentItem;
