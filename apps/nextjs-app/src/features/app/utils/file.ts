import UnknownFileIcon from '@teable/ui-lib/icons/app/unknown-file.svg';
import { renderToString } from 'react-dom/server';

export const getFileCover = (mimetype: string, url: string) => {
  if (mimetype.startsWith('image/')) {
    return url;
  }
  return 'data:image/svg+xml,' + encodeURIComponent(renderToString(UnknownFileIcon()));
};
