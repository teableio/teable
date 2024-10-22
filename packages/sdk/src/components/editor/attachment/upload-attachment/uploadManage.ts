import type { INotifyVo, UploadType } from '@teable/openapi';
import { getSignature, notify } from '@teable/openapi';
import axios from 'axios';
import { noop } from 'lodash';

interface IUploadTask {
  file: IFile;
  status: Status;
  progress: number;
  type: UploadType;
  baseId?: string;
  successCallback: ISuccessCallback;
  errorCallback: IErrorCallback;
  progressCallback: IProgressCallback;
}

export interface IFile {
  id: string;
  instance: File;
}

type ISuccessCallback = (file: IFile, attachment: INotifyVo) => void;

type IErrorCallback = (file: IFile, error?: string, code?: number) => void;

type IProgressCallback = (file: IFile, progress: number) => void;

export enum Status {
  Pending,
  Uploading,
  Completed,
}

export class AttachmentManager {
  limit: number;
  uploadQueue: IUploadTask[];
  shareId?: string;

  constructor(limit: number) {
    this.limit = limit;
    this.uploadQueue = [];
  }

  upload(
    files: IFile[],
    type: UploadType,
    callbackFn: {
      successCallback?: ISuccessCallback;
      errorCallback?: IErrorCallback;
      progressCallback?: IProgressCallback;
    },
    baseId?: string
  ) {
    const { successCallback = noop, errorCallback = noop, progressCallback = noop } = callbackFn;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const uploadTask: IUploadTask = {
        file,
        status: Status.Pending,
        progress: 0,
        type,
        baseId,
        successCallback: successCallback,
        errorCallback: errorCallback,
        progressCallback: progressCallback,
      };

      if (this.uploadQueue.length < this.limit) {
        this.executeUpload(uploadTask);
      } else {
        this.uploadQueue.push(uploadTask);
      }
    }
  }

  async executeUpload(uploadTask: IUploadTask) {
    uploadTask.status = Status.Uploading;

    try {
      const fileInstance = uploadTask.file.instance;
      const res = await getSignature(
        {
          type: uploadTask.type,
          contentLength: fileInstance.size,
          contentType: fileInstance.type,
          baseId: uploadTask?.baseId,
        },
        this.shareId
      ); // Assuming you have an AttachmentApi that provides the upload URL
      if (!res.data) {
        uploadTask.errorCallback(uploadTask.file, 'Failed to get upload URL');
        return;
      }
      const { url, uploadMethod, token, requestHeaders } = res.data;
      delete requestHeaders['Content-Length'];
      await axios(url, {
        method: uploadMethod,
        data: fileInstance,
        onUploadProgress: (progressEvent) => {
          const progress = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 0));
          uploadTask.progress = progress;
          uploadTask.progressCallback(uploadTask.file, progress); // Update progress
        },
        headers: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(requestHeaders as any),
        },
      });

      const notifyRes = await notify(token, this.shareId, fileInstance.name);
      if (!notifyRes.data) {
        uploadTask.errorCallback(uploadTask.file);
        return;
      }
      this.completeUpload(uploadTask, notifyRes.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      uploadTask.errorCallback(uploadTask.file, error?.message, error?.status);
    }
  }

  completeUpload(uploadTask: IUploadTask, attachment: INotifyVo) {
    uploadTask.status = Status.Completed;
    uploadTask.successCallback(uploadTask.file, attachment);

    // Check if there are pending upload tasks
    if (this.uploadQueue.length > 0) {
      const nextTask = this.uploadQueue.shift();
      nextTask && this.executeUpload(nextTask);
    }
  }
}
