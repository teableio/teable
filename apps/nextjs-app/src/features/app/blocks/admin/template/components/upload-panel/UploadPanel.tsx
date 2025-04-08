import { generateAttachmentId } from '@teable/core';
import { Plus } from '@teable/icons';
import type { ITemplateCoverRo, ITemplateCoverVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { AttachmentManager } from '@teable/sdk/components';
import { cn } from '@teable/ui-lib';
import { pick } from 'lodash';
import { useState } from 'react';
import { Process } from './Process';
import { TemplateCoverPreview } from './TemplateCoverPreview';
import { Trigger } from './Trigger';

interface IUploadPanelProps {
  file: File | null;
  accept?: string;
  onClose: () => void;
  onFinished: (result: ITemplateCoverRo) => void;
  onChange: (file: File | null) => void;
  cover?: ITemplateCoverVo;
}
const attchmentManager = new AttachmentManager(1);

const UploadPanel = (props: IUploadPanelProps) => {
  const { file, accept, onChange, onFinished, onClose, cover } = props;
  const [process, setProcess] = useState(0);
  const [isImporting, setIsImporting] = useState(false);

  return (
    <div
      className={cn('relative flex h-full w-full items-center justify-center', {
        'pointer-events-none': isImporting,
      })}
    >
      <Trigger
        onBeforeUpload={() => {
          setIsImporting(true);
        }}
        accept={accept}
        onChange={async (file) => {
          setIsImporting(false);
          if (file) {
            const attachmentId = generateAttachmentId();
            attchmentManager.upload([{ id: attachmentId, instance: file }], UploadType.Template, {
              successCallback: (_, result) => {
                const res = {
                  ...pick(result, ['token', 'path', 'size', 'url', 'mimetype']),
                  name: file.name,
                  id: attachmentId,
                };
                onFinished?.(res);
              },
              progressCallback: (_, process) => {
                setProcess(process);
              },
            });
          }
          onChange(file);
        }}
      >
        <div
          className={cn(
            'flex h-full items-center justify-center rounded-sm border-2 border-none hover:border-secondary',
            {
              'border-dashed': !cover,
            }
          )}
        >
          {!cover && !file && <Plus className="size-4" />}
          {cover && <TemplateCoverPreview cover={cover} onClose={onClose} />}
          {file && !cover && <Process process={process} />}
        </div>
      </Trigger>
    </div>
  );
};

export { UploadPanel };
