import { type ExtendEditor, getInjectedPlugins, pipeInsertDataQuery } from '@udecode/plate-common';
import type { ImageConfig } from './ImagePlugin';

/**
 * Allows for pasting images from clipboard. Not yet: dragging and dropping
 * images, selecting them through a file system dialog.
 */
export const withImageUpload: ExtendEditor<ImageConfig> = (params) => {
  const { editor, getOptions, plugin } = params;

  const { insertData } = editor;

  editor.insertData = (dataTransfer: DataTransfer) => {
    if (getOptions().disableUploadInsert) {
      return insertData(dataTransfer);
    }

    const text = dataTransfer.getData('text/plain');
    const { files } = dataTransfer;

    if (!text && files && files.length > 0) {
      const injectedPlugins = getInjectedPlugins(editor, plugin);

      if (
        !pipeInsertDataQuery(editor, injectedPlugins, {
          data: text,
          dataTransfer,
        })
      ) {
        return insertData(dataTransfer);
      }

      for (const file of files) {
        const [mime] = file.type.split('/');

        if (mime === 'image') {
          const customUploadImage = getOptions().customUploadImage;
          customUploadImage?.(file);
        }
      }
    } else {
      insertData(dataTransfer);
    }
  };

  return editor;
};
