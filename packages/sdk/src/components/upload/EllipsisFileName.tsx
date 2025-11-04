import { cn } from '@teable/ui-lib';
import { useMemo } from 'react';

export const EllipsisFileName = (props: {
  className?: string;
  name: string;
  endLength?: number;
}) => {
  const { className, name, endLength = 3 } = props;
  const { extension, fileName, end } = useMemo(() => {
    const extension = name.split('.').pop();
    const fileName = name.split('.').slice(0, -1).join('.');
    const fileNameLength = fileName.length;
    const end = fileNameLength > endLength ? fileName.slice(-endLength) : '';
    return {
      extension,
      fileName: end ? fileName.slice(0, fileNameLength - endLength) : fileName,
      end,
    };
  }, [name, endLength]);

  return (
    <div className={cn('text-center flex items-center justify-center truncate', className)}>
      <span className="truncate text-sm">{fileName}</span>
      <span className="text-sm">
        {end}
        {extension ? `.${extension}` : ''}
      </span>
    </div>
  );
};
