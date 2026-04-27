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

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0B';
  const units = ['B', 'k', 'M', 'G', 'T', 'P', 'E'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  const formatted = value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted}${units[i]}`;
}
