import type { IColumnMeta, IFieldVo, IOtOperation, IViewPropertyKeys, IViewVo } from '@teable/core';
import type { IRecord } from '@teable/openapi';
import type { ICellContext } from '../features/calculation/utils/changes';
import type { IOpsMap } from '../features/calculation/utils/compose-maps';
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
  [key: `plugin:auth-code:${string}`]: IPluginAuthStore;
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
  CreateView = 'createView',
  DeleteView = 'deleteView',
  UpdateView = 'updateView',
  CreateRecords = 'createRecords',
  DeleteRecords = 'deleteRecords',
  UpdateRecords = 'updateRecords',
  UpdateRecordsOrder = 'updateRecordsOrder',
  CreateFields = 'createFields',
  ConvertField = 'convertField',
  DeleteFields = 'deleteFields',
  PasteSelection = 'pasteSelection',
}

export interface IUndoRedoOperationBase {
  name: OperationName;
  params: Record<string, unknown>;
  result?: unknown;
}

export interface IUpdateRecordsOperation extends IUndoRedoOperationBase {
  name: OperationName.UpdateRecords;
  params: {
    tableId: string;
    recordIds: string[];
    fieldIds: string[];
  };
  result: {
    cellContexts?: ICellContext[];
    ordersMap?: {
      [recordId: string]: {
        newOrder?: Record<string, number>;
        oldOrder?: Record<string, number>;
      };
    };
  };
}

export interface IUpdateRecordsOrderOperation extends IUndoRedoOperationBase {
  name: OperationName.UpdateRecordsOrder;
  params: {
    tableId: string;
    viewId: string;
    recordIds: string[];
  };
  result: {
    ordersMap?: {
      [recordId: string]: {
        newOrder?: Record<string, number>;
        oldOrder?: Record<string, number>;
      };
    };
  };
}

export interface ICreateRecordsOperation extends IUndoRedoOperationBase {
  name: OperationName.CreateRecords;
  params: {
    tableId: string;
  };
  result: {
    records: (IRecord & { order?: Record<string, number> })[];
  };
}

export interface IDeleteRecordsOperation extends Omit<ICreateRecordsOperation, 'name'> {
  name: OperationName.DeleteRecords;
}

export interface IConvertFieldOperation extends IUndoRedoOperationBase {
  name: OperationName.ConvertField;
  params: {
    tableId: string;
  };
  result: {
    oldField: IFieldVo;
    newField: IFieldVo;
    modifiedOps?: IOpsMap;
    references?: string[];
    supplementChange?: {
      tableId: string;
      newField: IFieldVo;
      oldField: IFieldVo;
    };
  };
}

export interface ICreateFieldsOperation extends IUndoRedoOperationBase {
  name: OperationName.CreateFields;
  params: {
    tableId: string;
  };
  result: {
    fields: (IFieldVo & { columnMeta?: IColumnMeta; references?: string[] })[];
    records?: {
      id: string;
      fields: Record<string, unknown>;
    }[];
  };
}

export interface IDeleteFieldsOperation extends Omit<ICreateFieldsOperation, 'name'> {
  name: OperationName.DeleteFields;
}

export interface IPasteSelectionOperation extends IUndoRedoOperationBase {
  name: OperationName.PasteSelection;
  params: {
    tableId: string;
  };
  result: {
    updateRecords?: {
      recordIds: string[];
      fieldIds: string[];
      cellContexts: ICellContext[];
    };
    newFields?: (IFieldVo & { columnMeta?: IColumnMeta; references?: string[] })[];
    newRecords?: (IRecord & { order?: Record<string, number> })[];
  };
}

export interface ICreateViewOperation extends IUndoRedoOperationBase {
  name: OperationName.CreateView;
  params: {
    tableId: string;
  };
  result: {
    view: IViewVo;
  };
}

export interface IDeleteViewOperation extends IUndoRedoOperationBase {
  name: OperationName.DeleteView;
  params: {
    tableId: string;
    viewId: string;
  };
}

export interface IUpdateViewOperation extends IUndoRedoOperationBase {
  name: OperationName.UpdateView;
  params: {
    tableId: string;
    viewId: string;
  };
  result: {
    byKey?: {
      key: IViewPropertyKeys;
      newValue: unknown;
      oldValue: unknown;
    };
    byOps?: IOtOperation[];
  };
}

export type IUndoRedoOperation =
  | IUpdateRecordsOperation
  | ICreateRecordsOperation
  | IDeleteRecordsOperation
  | IUpdateRecordsOrderOperation
  | ICreateFieldsOperation
  | IDeleteFieldsOperation
  | IConvertFieldOperation
  | IPasteSelectionOperation
  | ICreateViewOperation
  | IDeleteViewOperation
  | IUpdateViewOperation;
export interface IPluginAuthStore {
  baseId: string;
  pluginId: string;
}
