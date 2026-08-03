import type { ITemplateCoverRo, ITemplateCoverVo } from '@teable/openapi';
import { useState } from 'react';
import { UploadPanel } from './upload-panel/UploadPanel';

interface ITemplateCoverProps {
  cover?: ITemplateCoverVo;
  onChange: (notify: ITemplateCoverRo | null) => void;
}

export const TemplateCover = (props: ITemplateCoverProps) => {
  const { onChange, cover } = props;

  const [file, setFile] = useState<File | null>(null);
  return (
    <div className="size-16">
      {
        <UploadPanel
          cover={cover}
          file={file}
          onClose={() => {
            setFile(null);
            onChange(null);
          }}
          onFinished={(res) => {
            onChange(res);
          }}
          onChange={(file) => {
            setFile(file);
          }}
          accept="image/*"
        />
      }
    </div>
  );
};
