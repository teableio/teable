import type { IAttachmentCellValue } from '@teable/core';
import { Plus } from '@teable/icons';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { noop } from 'lodash';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useIsTouchDevice } from '../../../hooks';
import type { ICellEditor } from '../type';
import { FileInput } from './upload-attachment/FileInput';
import type { IUploadAttachmentRef } from './upload-attachment/UploadAttachment';
import { UploadAttachment } from './upload-attachment/UploadAttachment';
import { AttachmentManager } from './upload-attachment/uploadManage';

type IAttachmentEditor = ICellEditor<IAttachmentCellValue> & {
  onDownload?: (attachments: IAttachmentCellValue) => void;
  tableId?: string;
  recordId?: string;
  fieldId?: string;
};

export const AttachmentEditor = (props: IAttachmentEditor) => {
  const {
    className,
    value,
    onChange = noop,
    readonly,
    onDownload,
    tableId,
    recordId,
    fieldId,
  } = props;
  const { t } = useTranslation();
  const uploadAttachmentRef = useRef<IUploadAttachmentRef>(null);
  const isTouchDevice = useIsTouchDevice();
  const attachmentManager = useRef(new AttachmentManager(2));
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // See SelectEditor: nested modal Popover traps expand-record pointer events (T7102).
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        !contentRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [open]);

  const hasAttachments = value && value.length > 0;
  const modeProps = useMemo(() => {
    if (tableId && recordId && fieldId) {
      return {
        mode: 'cell',
        tableId,
        recordId,
        fieldId,
      } as const;
    }
    return {
      mode: 'local',
      attachmentManager: attachmentManager.current,
      fieldId,
    } as const;
  }, [tableId, recordId, fieldId]);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        {isTouchDevice ? (
          <FileInput
            onChange={(files) => uploadAttachmentRef.current?.uploadAttachment(files)}
            disabled={readonly}
          />
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger ref={triggerRef} asChild>
              <Button variant="outline" size={'sm'} disabled={readonly}>
                <Plus className="size-4 shrink-0" />
                {t('editor.attachment.upload')}
              </Button>
            </PopoverTrigger>
            <PopoverContent ref={contentRef} align="start" className="w-[462px]">
              <UploadAttachment
                {...modeProps}
                attachments={value || []}
                onChange={onChange}
                readonly={readonly}
                className={cn('max-h-[320px] p-0 overflow-hidden')}
              />
            </PopoverContent>
          </Popover>
        )}

        {hasAttachments && onDownload && (
          <Button
            className="font-normal"
            variant="link"
            size={'sm'}
            onClick={() => onDownload(value)}
          >
            {t('editor.attachment.downloadAll')}
          </Button>
        )}
      </div>

      <div className="overflow-auto pt-2">
        <UploadAttachment
          {...modeProps}
          ref={uploadAttachmentRef}
          className={cn('p-0 max-h-[320px]', className)}
          attachments={value || []}
          onChange={onChange}
          readonly={readonly}
          disabled
        />
      </div>
    </div>
  );
};
