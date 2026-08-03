import type { INotifyVo, UploadType } from '@teable/openapi';
import { getSignature, notify } from '@teable/openapi';
import axios, { CanceledError } from 'axios';
import { noop } from 'lodash';

interface IUploadTask {
  file: IFile;
  status: Status;
  progress: number;
  type: UploadType;
  baseId?: string;
  abortController?: AbortController;
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
  uploadingQueue: IUploadTask[];
  shareId?: string;
  onUploadingTaskChange?: (uploadingTasks: IUploadTask[], pendingTasks: IUploadTask[]) => void;

  constructor(
    limit: number,
    options: {
      onUploadingTaskChange?: (uploadingTasks: IUploadTask[], pendingTasks: IUploadTask[]) => void;
    } = {}
  ) {
    this.limit = limit;
    this.uploadQueue = [];
    this.uploadingQueue = [];
    this.onUploadingTaskChange = options.onUploadingTaskChange || noop;
  }

  private notifyUploadingTaskChange() {
    this.onUploadingTaskChange?.(this.uploadingQueue, this.uploadQueue);
  }

  private addToUploadingQueue(uploadTask: IUploadTask) {
    this.uploadingQueue.push(uploadTask);
    this.notifyUploadingTaskChange();
  }

  private removeFromUploadingQueue(uploadTask: IUploadTask) {
    const index = this.uploadingQueue.findIndex((task) => task.file.id === uploadTask.file.id);
    if (index !== -1) {
      this.uploadingQueue.splice(index, 1);
      this.notifyUploadingTaskChange();
    }
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
      this.uploadQueue.push(uploadTask);
      this.nextUpload();
    }
  }

  async executeUpload(uploadTask: IUploadTask) {
    uploadTask.status = Status.Uploading;
    this.addToUploadingQueue(uploadTask);
    uploadTask.abortController = new AbortController();
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
        signal: uploadTask.abortController?.signal,
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
      // Skip error callback when the upload was intentionally cancelled
      if (error instanceof CanceledError || error?.name === 'AbortError') {
        return;
      }
      uploadTask.errorCallback(uploadTask.file, error?.message, error?.status);
    } finally {
      this.removeFromUploadingQueue(uploadTask);
      this.nextUpload();
    }
  }

  cancelTask(fileId: string) {
    // 1. from uploadQueue（pending） remove
    const pendingIdx = this.uploadQueue.findIndex((t) => t.file.id === fileId);
    if (pendingIdx !== -1) {
      this.uploadQueue.splice(pendingIdx, 1);
      return;
    }
    // 2. abort the uploading request
    const uploadingTask = this.uploadingQueue.find((t) => t.file.id === fileId);
    if (uploadingTask?.abortController) {
      uploadingTask.abortController.abort();
    }
  }

  completeUpload(uploadTask: IUploadTask, attachment: INotifyVo) {
    uploadTask.status = Status.Completed;
    uploadTask.successCallback(uploadTask.file, attachment);
  }

  nextUpload() {
    // Start as many uploads as possible up to the limit
    while (this.uploadingQueue.length < this.limit && this.uploadQueue.length > 0) {
      const nextTask = this.uploadQueue.shift();
      if (nextTask) {
        this.executeUpload(nextTask);
      }
    }
  }
}
