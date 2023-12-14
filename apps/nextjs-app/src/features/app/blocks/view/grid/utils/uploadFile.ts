import type { IAttachmentItem } from '@teable-group/core';
import { generateAttachmentId } from '@teable-group/core';
import type { INotifyVo } from '@teable-group/openapi';
import type { IFile } from '@teable-group/sdk';
import { AttachmentManager } from '@teable-group/sdk';

export const uploadFiles = async (files: FileList): Promise<IAttachmentItem[]> => {
  return new Promise((resolve, reject) => {
    const attachmentManager = new AttachmentManager(2);
    const attachments: IAttachmentItem[] = [];
    attachmentManager.upload(
      Array.from(files).map((file) => ({ instance: file, id: generateAttachmentId() })),
      {
        successCallback: (file: IFile, attachment: INotifyVo) => {
          const { instance, id } = file;
          const newAttachment: IAttachmentItem = {
            id,
            name: instance.name,
            ...attachment,
          };
          attachments.push(newAttachment);
          if (attachments.length === files.length) {
            resolve(attachments);
          }
        },
        errorCallback: (_file, error?: string) => {
          reject(error);
        },
      }
    );
  });
};
