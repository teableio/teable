import { getFileIcon, isImage } from '@teable/ui-lib';
import { renderToString } from 'react-dom/server';

export const getFileCover = (mimetype: string, url?: string, theme?: 'light' | 'dark') => {
  if (!url) return '';
  if (!isSystemFileIcon(mimetype)) {
    return url;
  }
  return getFieldIconString(mimetype, theme);
};

export const getFieldIconString = (mimetype: string, theme?: 'light' | 'dark') => {
  const FileIcon = getFileIcon(mimetype, theme);
  return 'data:image/svg+xml,' + encodeURIComponent(renderToString(FileIcon({})));
};

export const isSystemFileIcon = (mimetype: string) => {
  return !isImage(mimetype);
};
