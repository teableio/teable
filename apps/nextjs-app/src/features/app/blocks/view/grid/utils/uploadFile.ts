import type { IAttachmentItem } from '@teable/core';
import { generateAttachmentId } from '@teable/core';
import { UploadType, type INotifyVo } from '@teable/openapi';
import type { IFile } from '@teable/sdk';
import { AttachmentManager } from '@teable/sdk';

export const uploadFiles = async (files: FileList): Promise<IAttachmentItem[]> => {
  return new Promise((resolve, reject) => {
    const attachmentManager = new AttachmentManager(2);
    const attachments: IAttachmentItem[] = [];
    attachmentManager.upload(
      Array.from(files).map((file) => ({ instance: file, id: generateAttachmentId() })),
      UploadType.Table,
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
