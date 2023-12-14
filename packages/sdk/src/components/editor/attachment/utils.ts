import { getFileIcon, isImage } from '@teable-group/ui-lib';
import { renderToString } from 'react-dom/server';

export const getFileCover = (mimetype: string, url: string) => {
  if (!isSystemFileIcon(mimetype)) {
    return url;
  }
  const FileIcon = getFileIcon(mimetype);
  return 'data:image/svg+xml,' + encodeURIComponent(renderToString(FileIcon({})));
};

export const isSystemFileIcon = (mimetype: string) => {
  return !isImage(mimetype);
};
