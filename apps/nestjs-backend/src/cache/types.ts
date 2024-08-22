import type { IRecord } from '@teable/openapi';
import type { ICellContext } from '../features/calculation/utils/changes';
import type { ISessionData } from '../types/session';

/* eslint-disable @typescript-eslint/naming-convention */
export interface ICacheStore {
  [key: `attachment:signature:${string}`]: IAttachmentSignatureCache;
  [key: `attachment:upload:${string}`]: IAttachmentUploadCache;
  [key: `attachment:local-signature:${string}`]: IAttachmentLocalTokenCache;
  [key: `attachment:preview:${string}`]: IAttachmentPreviewCache;
  [key: `auth:session-store:${string}`]: ISessionData;
  [key: `auth:session-user:${string}`]: Record<string, number>;
  [key: `auth:session-expire:${string}`]: boolean;
  [key: `oauth2:${string}`]: IOauth2State;
  [key: `reset-password-email:${string}`]: IResetPasswordEmailCache;
  [key: `workflow:running:${string}`]: string;
  [key: `workflow:repeatKey:${string}`]: string;
  [key: `oauth:code:${string}`]: IOAuthCodeState;
  [key: `oauth:txn:${string}`]: IOAuthTxnStore;
  // userId:tableId:windowId
  [key: `operations:undo:${string}:${string}:${string}`]: IUndoRedoOperation[];
  [key: `operations:redo:${string}:${string}:${string}`]: IUndoRedoOperation[];
}

export interface IAttachmentSignatureCache {
  path: string;
  bucket: string;
  hash?: string;
}

export interface IAttachmentUploadCache {
  mimetype: string;
  hash: string;
  size: number;
}

export interface IAttachmentLocalTokenCache {
  expiresDate: number;
  contentLength: number;
  contentType: string;
}

export interface IAttachmentPreviewCache {
  url: string;
  expiresIn: number;
}

export interface IOauth2State {
  redirectUri?: string;
}

export interface IResetPasswordEmailCache {
  userId: string;
}

export interface IOAuthCodeState {
  scopes: string[];
  redirectUri: string;
  clientId: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface IOAuthTxnStore {
  redirectURI: string;
  clientId: string;
  type: string;
  scopes: string[];
  userId: string;
  state?: string;
}

export enum OperationName {
  CreateRecords = 'createRecords',
  DeleteRecords = 'deleteRecords',
  UpdateRecords = 'updateRecords',
  CreateField = 'createField',
  UpdateField = 'updateField',
  DeleteField = 'deleteField',
  Paste = 'paste',
}

export interface IUndoRedoOperationBase {
  name: OperationName;
  params: Record<string, unknown>;
  result: unknown;
}

export interface IUpdateRecordsOperation extends IUndoRedoOperationBase {
  name: OperationName.UpdateRecords;
  params: {
    tableId: string;
    recordIds: string[];
    fieldIds: string[];
  };
  result: {
    cellContexts: ICellContext[];
  };
}

export interface ICreateRecordsOperation extends IUndoRedoOperationBase {
  name: OperationName.CreateRecords;
  params: {
    tableId: string;
  };
  result: {
    records: (IRecord & { order: Record<string, number> | undefined })[];
  };
}

export interface IDeleteRecordsOperation extends IUndoRedoOperationBase {
  name: OperationName.DeleteRecords;
  params: {
    tableId: string;
  };
  result: {
    records: (IRecord & { order: Record<string, number> | undefined })[];
  };
}

export type IUndoRedoOperation =
  | IUpdateRecordsOperation
  | ICreateRecordsOperation
  | IDeleteRecordsOperation;
