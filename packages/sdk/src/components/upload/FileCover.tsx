import { useTheme } from '@teable/next-themes';
import { getFileIcon, isImage } from '@teable/ui-lib';
import { useMemo } from 'react';

interface IFileCoverProps {
  className?: string;
  mimetype: string;
  url?: string;
  name?: string;
}

export const FileCover = (props: IFileCoverProps) => {
  const { className, mimetype, url, name } = props;
  const { resolvedTheme } = useTheme();
  const FileIcon = useMemo(
    () => getFileIcon(mimetype, resolvedTheme as 'light' | 'dark'),
    [mimetype, resolvedTheme]
  );

  if (isImage(mimetype)) {
    return <img className={className} src={url} alt={name} />;
  }
  return <FileIcon />;
};
