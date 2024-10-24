import { ATTACHMENT_SM_THUMBNAIL_HEIGHT, ATTACHMENT_LG_THUMBNAIL_HEIGHT } from '@teable/core';
import { ThumbnailSize } from '../features/attachments/plugins/types';
import { generateCutImagePath } from '../features/attachments/plugins/utils';

export const generateTableThumbnailPath = (path: string) => {
  return {
    smThumbnailPath: generateCutImagePath(path, ThumbnailSize.SM),
    lgThumbnailPath: generateCutImagePath(path, ThumbnailSize.LG),
  };
};

export const getTableThumbnailToken = (path: string) => {
  const token = path.split('/').pop();
  if (!token) {
    throw new Error('Invalid path');
  }
  return token;
};

export const getTableThumbnailSize = (width: number, height: number) => {
  const aspectRatio = width / height;
  const smWidth = aspectRatio * ATTACHMENT_SM_THUMBNAIL_HEIGHT;
  const lgWidth = aspectRatio * ATTACHMENT_LG_THUMBNAIL_HEIGHT;
  return {
    smThumbnail: {
      width: Math.round(smWidth),
      height: Math.round(ATTACHMENT_SM_THUMBNAIL_HEIGHT),
    },
    lgThumbnail: {
      width: Math.round(lgWidth),
      height: Math.round(ATTACHMENT_LG_THUMBNAIL_HEIGHT),
    },
  };
};
