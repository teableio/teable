import type { IAttachmentCellValue } from '@teable/core';
import { Plus } from '@teable/icons';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { noop } from 'lodash';
import { useMemo, useRef } from 'react';
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
    } as const;
  }, [tableId, recordId, fieldId]);
  return (
    <div>
      <div className="flex gap-2">
        {isTouchDevice ? (
          <FileInput
            onChange={(files) => uploadAttachmentRef.current?.uploadAttachment(files)}
            disabled={readonly}
          />
        ) : (
          <Popover modal>
            <PopoverTrigger asChild>
              <Button variant="outline" size={'sm'} disabled={readonly}>
                <Plus fontSize={16} />
                {t('editor.attachment.upload')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[462px]">
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
