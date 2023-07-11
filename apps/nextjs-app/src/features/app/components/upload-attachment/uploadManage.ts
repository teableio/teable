import type { AttachmentSchema } from '@teable-group/openapi';
import { AttachmentApi } from '@teable-group/openapi';
import axios from 'axios';
import { noop } from 'lodash';

interface IUploadTask {
  file: IFile;
  status: Status;
  progress: number;
  successCallback: ISuccessCallback;
  errorCallback: IErrorCallback;
  progressCallback: IProgressCallback;
}

export interface IFile {
  id: string;
  instance: File;
}

type ISuccessCallback = (file: IFile, attachment: AttachmentSchema.NotifyVo) => void;

type IErrorCallback = (file: IFile, error?: string) => void;

type IProgressCallback = (file: IFile, progress: number) => void;

export enum Status {
  Pending,
  Uploading,
  Completed,
}

export class AttachmentManager {
  limit: number;
  uploadQueue: IUploadTask[];

  constructor(limit: number) {
    this.limit = limit;
    this.uploadQueue = [];
  }

  upload(
    files: IFile[],
    callbackFn: {
      successCallback?: ISuccessCallback;
      errorCallback?: IErrorCallback;
      progressCallback?: IProgressCallback;
    }
  ) {
    const { successCallback = noop, errorCallback = noop, progressCallback = noop } = callbackFn;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const uploadTask: IUploadTask = {
        file,
        status: Status.Pending,
        progress: 0,
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
      const res = await AttachmentApi.getSignature(); // Assuming you have an AttachmentApi that provides the upload URL
      if (!res.data.success) {
        uploadTask.errorCallback(uploadTask.file, 'Failed to get upload URL');
        return;
      }

      const formData = new FormData();

      formData.append('file', uploadTask.file.instance);

      const { url, secret } = res.data.data;

      const response = await axios.post(url, formData, {
        onUploadProgress: (progressEvent) => {
          const progress = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 0));
          uploadTask.progress = progress;
          uploadTask.progressCallback(uploadTask.file, progress); // Update progress
        },
      });

      if (!response.data.success) {
        uploadTask.errorCallback(uploadTask.file);
        return;
      }
      const notifyRes = await AttachmentApi.notify(secret);
      if (!notifyRes.data.success) {
        uploadTask.errorCallback(uploadTask.file);
        return;
      }
      this.completeUpload(uploadTask, notifyRes.data.data);
    } catch (error) {
      uploadTask.errorCallback(uploadTask.file);
    }
  }

  completeUpload(uploadTask: IUploadTask, attachment: AttachmentSchema.NotifyVo) {
    uploadTask.status = Status.Completed;
    uploadTask.successCallback(uploadTask.file, attachment);

    // Check if there are pending upload tasks
    if (this.uploadQueue.length > 0) {
      const nextTask = this.uploadQueue.shift();
      nextTask && this.executeUpload(nextTask);
    }
  }
}
