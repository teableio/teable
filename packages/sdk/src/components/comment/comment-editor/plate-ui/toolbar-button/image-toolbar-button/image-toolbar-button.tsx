import { generateAttachmentId } from '@teable/core';
import { Image } from '@teable/icons';
import type { INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Button } from '@teable/ui-lib';
import { insertNodes } from '@udecode/plate-common';
import { focusEditor, useEditorRef } from '@udecode/plate-common/react';
import type { TImageElement } from '@udecode/plate-media';
import { ImagePlugin } from '@udecode/plate-media';
import { useRef } from 'react';
import { AttachmentManager } from '../../../../../../components';
import { useTranslation } from '../../../../../../context/app/i18n';

export const ImageToolbarButton = () => {
  const editor = useEditorRef();
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const uploadFile = async (file: File) => {
    return new Promise<INotifyVo>((resolve) => {
      const attchmentManager = new AttachmentManager(1);
      attchmentManager.upload(
        [{ id: generateAttachmentId(), instance: file }],
        UploadType.Comment,
        {
          successCallback: (_, result) => {
            resolve(result);
          },
        }
      );
    });
  };
  const onFileChangeHandler = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = (e.target.files && Array.from(e.target.files)) || null;
    if (files && files.length > 0) {
      const result = await uploadFile(files[0]);
      const image: TImageElement = {
        children: [{ text: '' }],
        type: editor.getType(ImagePlugin),
        url: result.presignedUrl,
        path: result.path,
      };
      insertNodes<TImageElement>(editor, image, {
        nextBlock: true,
      });
      focusEditor(editor);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size={'xs'}
            variant={'ghost'}
            onClick={async () => {
              if (imageUploadRef?.current) {
                imageUploadRef.current.value = '';
                imageUploadRef?.current?.click();
              }
            }}
          >
            <Image />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={imageUploadRef}
              onChange={onFileChangeHandler}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('comment.toolbar.image')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
