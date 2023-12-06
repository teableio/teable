import { getFileIcon } from '@teable-group/ui-lib';
import { renderToString } from 'react-dom/server';

export const getFileCover = (mimetype: string, url: string) => {
  if (mimetype.startsWith('image/')) {
    return url;
  }
  const FileIcon = getFileIcon(mimetype);
  return 'data:image/svg+xml,' + encodeURIComponent(renderToString(FileIcon({})));
};
