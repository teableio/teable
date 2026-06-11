import { Progress, isImage } from '@teable/ui-lib';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EllipsisFileName } from '../../../upload/EllipsisFileName';
import { FileCover } from '../../../upload/FileCover';

interface IUploadingFileProps {
  file: File;
  progress: number;
  onCancel?: () => void;
}

export const UploadingFile = ({ file, progress, onCancel }: IUploadingFileProps) => {
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    let url: string | undefined = undefined;
    if (isImage(file.type)) {
      url = URL.createObjectURL(file);
      setObjectUrl(url);
    }
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [file]);
  return (
    <div>
      <li className="group flex h-[132px] w-[104px] flex-col gap-2 rounded-lg p-1">
        <div className="relative flex-1 overflow-hidden rounded-lg">
          <div className="flex size-full items-center">
            <FileCover
              className="size-full object-cover"
              mimetype={file.type}
              url={objectUrl}
              name={file.name}
            />
          </div>
          <div className="absolute inset-0 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-border bg-black/60 px-4 text-white/85">
            <Progress indicatorClassName="bg-white" value={progress} />
            {progress}%
          </div>
          {onCancel && (
            <button
              type="button"
              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
              onClick={onCancel}
            >
              <X className="size-3 text-white" />
            </button>
          )}
        </div>
        <EllipsisFileName name={file.name} endLength={3} />
      </li>
    </div>
  );
};
