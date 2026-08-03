'use client';

import { sonner } from '@teable/ui-lib';

import { usePluginOption } from '@udecode/plate/react';
import { PlaceholderPlugin, UploadErrorCode } from '@udecode/plate-media/react';
import * as React from 'react';

const { toast } = sonner;

export const useUploadErrorToast = () => {
  const uploadError = usePluginOption(PlaceholderPlugin, 'error');

  React.useEffect(() => {
    if (!uploadError) return;

    const { code, data } = uploadError;

    switch (code) {
      case UploadErrorCode.INVALID_FILE_SIZE: {
        toast.error(`The size of files ${data.files.map((f) => f.name).join(', ')} is invalid`);

        break;
      }
      case UploadErrorCode.INVALID_FILE_TYPE: {
        toast.error(`The type of files ${data.files.map((f) => f.name).join(', ')} is invalid`);

        break;
      }
      case UploadErrorCode.TOO_LARGE: {
        toast.error(
          `The size of files ${data.files
            .map((f) => f.name)
            .join(', ')} is too large than ${data.maxFileSize}`
        );

        break;
      }
      case UploadErrorCode.TOO_LESS_FILES: {
        toast.error(`The mini um number of files is ${data.minFileCount} for ${data.fileType}`);

        break;
      }
      case UploadErrorCode.TOO_MANY_FILES: {
        toast.error(
          `The maximum number of files is ${data.maxFileCount} ${
            data.fileType ? `for ${data.fileType}` : ''
          }`
        );

        break;
      }
    }
  }, [uploadError]);
};

export const MediaUploadToast = () => {
  useUploadErrorToast();

  return null;
};
