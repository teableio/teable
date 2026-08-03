import { generateAttachmentId } from '@teable/core';
import type { INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { useState } from 'react';
import { AttachmentManager } from '../../../editor';

export function useUploadFile() {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<{
    key: string;
    url: string;
    name: string;
    size: number;
    type: string;
    path: string;
  } | null>(null);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setUploadingFile(file);
    setProgress(0);

    try {
      const attachmentManager = new AttachmentManager(1);
      const attachmentResult = await new Promise<INotifyVo>((resolve, reject) => {
        attachmentManager.upload(
          [
            {
              id: generateAttachmentId(),
              instance: file,
            },
          ],
          UploadType.Comment,
          {
            successCallback: (_, result) => {
              resolve(result);
            },
            errorCallback: (_, error) => {
              reject(error);
            },
            progressCallback: (_, progress) => {
              setProgress(progress);
            },
          }
        );
      });

      const result = {
        key: attachmentResult.token,
        url: attachmentResult.presignedUrl,
        name: file.name,
        size: file.size,
        type: file.type,
        path: attachmentResult.path,
      };
      setUploadedFile(result);
      return result;
    } catch (err) {
      setUploadedFile(null);
      throw err;
    } finally {
      setIsUploading(false);
      setUploadingFile(null);
      setProgress(0);
    }
  };

  return {
    isUploading,
    progress,
    uploadedFile,
    uploadFile,
    uploadingFile,
  };
}
