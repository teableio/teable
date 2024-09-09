import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IAttachmentItem } from '@teable/core';
import { Download, X } from '@teable/icons';
import { Button, cn, FilePreviewItem } from '@teable/ui-lib';
import React from 'react';
import { isSystemFileIcon } from '../utils';

interface IUploadAttachment {
  attachment: IAttachmentItem;
  readonly?: boolean;
  onDelete: (id: string) => void;
  fileCover: (data: IAttachmentItem) => string;
  downloadFile: (data: IAttachmentItem) => void;
}

function AttachmentItem(props: IUploadAttachment) {
  const { attachment, onDelete, fileCover, downloadFile, readonly } = props;

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: attachment.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <li key={attachment.id} className="mb-2 flex h-32 w-28 flex-col pr-3">
        <div
          className={cn(
            'group relative flex-1 cursor-pointer overflow-hidden rounded-md border border-border',
            {
              'border-none': isSystemFileIcon(attachment.mimetype),
            }
          )}
        >
          <FilePreviewItem
            className="flex items-center justify-center"
            src={attachment.presignedUrl || ''}
            name={attachment.name}
            mimetype={attachment.mimetype}
            size={attachment.size}
          >
            <img
              className="size-full object-contain"
              src={fileCover(attachment)}
              alt={attachment.name}
            />
          </FilePreviewItem>
          <ul className="absolute right-0 top-0 hidden w-full justify-end space-x-1 bg-black/40 p-1 group-hover:flex">
            <li>
              <Button
                variant={'ghost'}
                className="size-5 rounded-full p-0 text-white focus-visible:ring-transparent focus-visible:ring-offset-0"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadFile(attachment);
                }}
              >
                <Download />
              </Button>
            </li>
            <li>
              {!readonly && (
                <Button
                  variant={'ghost'}
                  className="size-5 rounded-full p-0 text-white focus-visible:ring-transparent focus-visible:ring-offset-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(attachment.id);
                  }}
                >
                  <X />
                </Button>
              )}
            </li>
          </ul>
        </div>
        <span className="mt-1 w-full truncate text-center" title={attachment.name}>
          {attachment.name}
        </span>
      </li>
    </div>
  );
}

export default AttachmentItem;
