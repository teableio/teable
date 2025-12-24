import type { IAttachmentCellValue } from '@teable/core';
import { Plus } from '@teable/icons';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { noop } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useIsTouchDevice } from '../../../hooks';
import type { ICellEditor } from '../type';
import { FileInput } from './upload-attachment/FileInput';
import type { IUploadAttachmentRef } from './upload-attachment/UploadAttachment';
import { UploadAttachment } from './upload-attachment/UploadAttachment';
import { AttachmentManager } from './upload-attachment/uploadManage';

type IAttachmentEditor = ICellEditor<IAttachmentCellValue>;

export const AttachmentEditor = (props: IAttachmentEditor) => {
  const { className, value, onChange = noop, readonly } = props;
  const { t } = useTranslation();
  const uploadAttachmentRef = useRef<IUploadAttachmentRef>(null);
  const isTouchDevice = useIsTouchDevice();
  const [uploadingCount, setUploadingCount] = useState(0);
  const attachmentManager = useRef(new AttachmentManager(2));

  useEffect(() => {
    attachmentManager.current.onUploadingTaskChange = (uploadingTasks, pendingTasks) => {
      setUploadingCount(uploadingTasks.length + pendingTasks.length);
    };
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      attachmentManager.current.onUploadingTaskChange = undefined;
    };
  }, []);
  return (
    <div>
      {isTouchDevice ? (
        <FileInput
          onChange={(files) => uploadAttachmentRef.current?.uploadAttachment(files)}
          disabled={readonly}
        />
      ) : (
        <Popover
          modal
          onOpenChange={(value) => {
            if (!value) {
              setUploadingCount(0);
            }
          }}
        >
          <PopoverTrigger>
            <Button variant="outline" size={'sm'} className="w-full" disabled={readonly}>
              <Plus fontSize={16} />
              {t('editor.attachment.upload')}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className={cn('max-h-[320px] w-[462px] p-0 overflow-hidden', {
              'h-[320px]': (value?.length || 0) + uploadingCount > 4,
            })}
            align="start"
          >
            <UploadAttachment
              attachments={value || []}
              onChange={onChange}
              readonly={readonly}
              attachmentManager={attachmentManager.current}
            />
          </PopoverContent>
        </Popover>
      )}

      <div className="max-h-[320px] overflow-auto pt-2">
        <div>
          <UploadAttachment
            attachmentManager={attachmentManager.current}
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
