import { Progress, isImage } from '@teable/ui-lib';
import { useEffect, useState } from 'react';
import { EllipsisFileName } from '../../../upload/EllipsisFileName';
import { FileCover } from '../../../upload/FileCover';

export const UploadingFile = ({ file, progress }: { file: File; progress: number }) => {
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
      <li className="flex h-[132px] w-[104px] flex-col rounded-lg p-1">
        <div className="relative flex-1 overflow-hidden rounded-lg">
          <div className="absolute inset-0">
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
        </div>
        <EllipsisFileName name={file.name} endLength={3} />
      </li>
    </div>
  );
};
