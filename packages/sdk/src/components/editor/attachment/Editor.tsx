import type { IAttachmentCellValue } from '@teable/core';
import { Plus } from '@teable/icons';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { noop } from 'lodash';
import { useRef } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useIsTouchDevice } from '../../../hooks';
import type { ICellEditor } from '../type';
import { FileInput } from './upload-attachment/FileInput';
import type { IUploadAttachmentRef } from './upload-attachment/UploadAttachment';
import { UploadAttachment } from './upload-attachment/UploadAttachment';

type IAttachmentEditor = ICellEditor<IAttachmentCellValue>;

export const AttachmentEditor = (props: IAttachmentEditor) => {
  const { className, value, onChange = noop, readonly } = props;
  const { t } = useTranslation();
  const uploadAttachmentRef = useRef<IUploadAttachmentRef>(null);
  const isTouchDevice = useIsTouchDevice();
  return (
    <div>
      {isTouchDevice ? (
        <FileInput
          onChange={(files) => uploadAttachmentRef.current?.uploadAttachment(files)}
          disabled={readonly}
        />
      ) : (
        <Popover modal>
          <PopoverTrigger>
            <Button variant="outline" className="w-full" disabled={readonly}>
              <Plus />
              {t('editor.attachment.upload')}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className={cn('max-h-[498px] w-[560px] p-0', {
              'h-[498px]': value?.length && value.length > 8,
            })}
            align="start"
          >
            <UploadAttachment attachments={value || []} onChange={onChange} readonly={readonly} />
          </PopoverContent>
        </Popover>
      )}

      <div className="max-h-[498px] overflow-auto">
        <div>
          <UploadAttachment
            ref={uploadAttachmentRef}
            className={cn('p-0', className)}
            attachments={value || []}
            onChange={onChange}
            readonly={readonly}
            disabled
          />
        </div>
      </div>
    </div>
  );
};
