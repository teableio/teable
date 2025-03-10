import { generateAttachmentId } from '@teable/core';
import type { SUPPORTEDTYPE, INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { AttachmentManager } from '@teable/sdk/components';
import { Spin, Button, cn } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { Process } from './Process';
import { Trigger } from './Trigger';

interface IUploadPanelProps {
  file: File | null;
  fileType: SUPPORTEDTYPE;
  analyzeLoading: boolean;
  onClose: () => void;
  onFinished: (result: INotifyVo) => void;
  onChange: (file: File | null) => void;
}
const attchmentManager = new AttachmentManager(1);

const UploadPanel = (props: IUploadPanelProps) => {
  const { file, fileType, onChange, onFinished, onClose, analyzeLoading } = props;
  const { t } = useTranslation(['table']);
  const [process, setProcess] = useState(0);
  const [isImporting, setIsImporting] = useState(false);

  return (
    <div
      className={cn('relative flex h-96 items-center justify-center', {
        'pointer-events-none': isImporting,
      })}
    >
      {!file ? (
        <Trigger
          onBeforeUpload={() => {
            setIsImporting(true);
          }}
          fileType={fileType}
          onChange={async (file) => {
            setIsImporting(false);
            if (file) {
              attchmentManager.upload(
                [{ id: generateAttachmentId(), instance: file }],
                UploadType.Import,
                {
                  successCallback: (_, result) => {
                    onFinished?.(result);
                  },
                  progressCallback: (_, process) => {
                    setProcess(process);
                  },
                }
              );
            }
            onChange(file);
          }}
        >
          <div className="flex h-full items-center justify-center rounded-sm border-2 border-dashed hover:border-secondary">
            {!isImporting ? (
              <Button variant="ghost">{t('table:import.tips.importWayTip')}</Button>
            ) : (
              <div className="absolute flex size-full items-center justify-center bg-secondary opacity-90">
                <span className="mr-1 size-4 animate-spin">
                  <Spin className="size-4" />
                </span>
                <span>{t('table:import.tips.importing')}</span>
              </div>
            )}
          </div>
        </Trigger>
      ) : (
        <>
          <Process file={file} onClose={onClose} process={process}></Process>
          {analyzeLoading && (
            <div className="absolute flex size-full items-center justify-center bg-secondary opacity-90">
              <Spin className="mr-1 size-4" />
              <span>{t('table:import.tips.analyzing')}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export { UploadPanel };
