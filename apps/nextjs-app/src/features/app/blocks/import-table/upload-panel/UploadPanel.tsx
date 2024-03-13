import type { SUPPORTEDTYPE } from '@teable/core';
import type { INotifyVo } from '@teable/openapi';
import { Button, Spin } from '@teable/ui-lib';
import { useTranslation } from 'react-i18next';
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

const UploadPanel = (props: IUploadPanelProps) => {
  const { file, fileType, onChange, onFinished, onClose, analyzeLoading } = props;
  const { t } = useTranslation(['table']);

  return (
    <div className="relative flex h-96 items-center justify-center">
      {!file ? (
        <Trigger fileType={fileType} onChange={onChange}>
          <div className="flex h-full cursor-pointer items-center justify-center rounded-sm border-2 border-dashed hover:border-secondary">
            <Button variant="ghost">{t('table:import.tips.importWayTip')}</Button>
          </div>
        </Trigger>
      ) : (
        <>
          <Process file={file} onFinished={onFinished} onClose={onClose}></Process>
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
