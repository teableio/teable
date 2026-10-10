import type { IColumnMeta, IFieldVo, IOtOperation, IViewPropertyKeys, IViewVo } from '@teable/core';
import type { IRecord, MailType } from '@teable/openapi';
import type { ICellContext } from '../features/calculation/utils/changes';
import type { IOpsMap } from '../features/calculation/utils/compose-maps';
import type { ISendMailOptions } from '../features/mail-sender/mail-helpers';
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
  // Epoch seconds of the user's last clearByUserId, kept for the session ttl:
  // distinguishes "revoked by sign-out-everywhere" from "lost the concurrent
  // read-modify-write on the per-user session map".
  [key: `auth:session-user-cleared:${string}`]: number;
  [key: `oauth2:${string}`]: IOauth2State;
  // Mobile app sign-in (PKCE): keyed by the SHA-256 of the one-time code.
  [key: `auth:mobile-code:${string}`]: IMobileAuthCodeState;
  [key: `auth:mobile-web-session:${string}`]: IMobileWebSessionState;
  // WebView sessions signed in through a web-session code, keyed by the native session id.
  [key: `auth:mobile-children:${string}`]: string[];
  [key: `reset-password-email:${string}`]: IResetPasswordEmailCache;
  [key: `workflow:running:${string}`]: string;
  [key: `workflow:repeatKey:${string}`]: string;
  [key: `oauth:code:${string}`]: IOAuthCodeState;
  [key: `oauth:txn:${string}`]: IOAuthTxnStore;
  // Device authorization grant: the state lives under the device code the CLI
  // polls with, and the user code the person types is only an index into it.
  [key: `oauth:device:${string}`]: IOAuthDeviceState;
  [key: `oauth:device-user:${string}`]: string;
  [key: `oauth:device-rate:${string}`]: number;
  [key: `reward:claim-gate:${string}`]: string;
  // Poll pacing lives in a side key (TTL = the poll interval), NOT on the
  // state: a pending poll that wrote the state back could clobber a
  // concurrent approval.
  [key: `oauth:device-poll:${string}`]: number;
  // userId:tableId:windowId
  [key: `operations:undo:${string}:${string}:${string}`]: IUndoRedoOperation[];
  [key: `operations:redo:${string}:${string}:${string}`]: IUndoRedoOperation[];
  [key: `operations:engine:${string}:${string}:${string}`]: 'v1' | 'v2';
  [key: `plugin:auth-code:${string}`]: IPluginAuthStore;
  [key: `signin:attempts:${string}`]: number;
  [key: `signin:lockout:${string}`]: boolean;
  // Email one-time codes (sign-in / sign-up keyed by email, change-email keyed
  // by user id): the active code plus the wrong-guess counter that discards it
  // after too many attempts. The code lives only here — never inside a token
  // handed to the client, since a JWT is signed, not encrypted.
  [key: `auth:signin-code:${string}`]: IEmailCodeCache;
  [key: `auth:signin-code-attempts:${string}`]: number;
  [key: `auth:signup-code:${string}`]: IEmailCodeCache;
  [key: `auth:signup-code-attempts:${string}`]: number;
  [key: `auth:change-email-code:${string}`]: IEmailCodeCache;
  [key: `auth:change-email-code-attempts:${string}`]: number;
  [key: `query-params:${string}`]: Record<string, unknown>;
  // Collaborator notify coalescing per `${fromUserId}:${toUserId}:${tableId}`, shared across pods.
  [key: `collaborator-notify:window:${string}`]: boolean;
  [key: `collaborator-notify:pending:${string}`]: ICollaboratorNotifyPending;
  [key: `mail-sender:notify-mail-merge:${string}`]: (ISendMailOptions & {
    mailType: MailType;
  })[];
  [key: `waitlist:invite-code:${string}`]: number;
  [key: `send-mail-rate-limit:${string}`]: boolean;
  [key: `oauth:token-rate:${string}:${string}`]: number;
  // notifications third-party OAuth apps send: per app (and user) per one-minute window
  [key: `notification:app-rate:${string}`]: number;
  [key: `email:send:rate:${string}:${number}`]: number;
  [key: `automation:email-att:${string}`]: string[];
  [key: `automation:fail-notify-count:${string}`]: number;
  // Watchdog round-robin scan cursor per status (staleAt stored as ISO string).
  [key: `automation:orphan-cursor:${string}`]: { staleAt: string; key: string };
  [key: `task:watchdog-cursor:${string}`]: { staleAt: string; key: string };
  [key: `computed-reliability:snapshot:${string}`]: {
    count: number;
    oldestAt: number | null;
    sampledAt: number;
  };
  [key: `routine:watchdog-cursor:${string}`]: { staleAt: string; key: string };
  [key: `media:watchdog-cursor:${string}`]: { staleAt: string; key: string };
  [key: `routine:fail-notify-count:${string}`]: number;
  // Push: where the app is right now, so nothing is pushed to a screen its owner is
  // already reading. Written by the app on foreground / chat open / a slow heartbeat.
  [key: `push:presence:${string}:${string}`]: { chatId?: string };
  // Push: the gate a turn is parked on, so only the transition into one is announced and
  // only a gate that *was* announced is withdrawn. Keyed by the assistant message.
  // `announced: false` records a gate that was seen and deliberately not sent (the switch
  // is off, the owner is looking at it); it is kept briefly so the decision is revisited
  // while the gate still stands, rather than once and for all.
  [key: `push:gate:${string}`]: { toolName: string; announced: boolean };
  // Push: the gates a person was *not* told about because the app was open, keyed by the
  // assistant message. Read back when the app leaves the foreground, which is the moment
  // the reason for the silence lapses — a parked turn does not checkpoint again on its own.
  [key: `push:gate-shelved:${string}`]: Record<
    string,
    { chatId: string; toolName: string; detail?: string }
  >;
  // Push: results sent to a user inside the current window. Past the cap the individual
  // cards give way to one "N conversations have news" summary.
  [key: `push:burst:${string}`]: number;
  // Distributed lock keys
  [key: `lock:${string}`]: string;
  [key: `import:result:manifest:${string}`]: {
    successCount: number;
    failedCount: number;
    errorFilePaths: string[];
    fieldNames: string[];
    maxWidth: number;
    errorReportUrl?: string;
  };
  [key: `import:latest-job:${string}`]: string;
  // trash cleanup: per-item backoff after failed cleanup attempts
  [key: `trash-cleanup:skipped:${string}`]: { attempts: number; retryAfter: number };
  // space-load exporter (EE): pg_stat counter baseline + sampling watermarks
  ['space-load:pgstat-baseline']: {
    snapshotAt: string;
    totals: Record<string, [number, number, number]>;
  };
  ['space-load:compute-watermark']: { watermark: string; boundaryKeys: string[] };
  ['space-load:dead-letter-watermark']: string;
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
  /** Storage config fingerprint the URL was generated under; mismatch = stale. */
  configSig?: string;
}

export interface IOauth2State {
  redirectUri?: string;
}

export interface IMobileAuthCodeState {
  userId: string;
  codeChallenge: string;
  redirectUri: string;
  createdAt: number;
}

export interface IMobileWebSessionState {
  userId: string;
  /** The native (cookie) session that minted the code. */
  parentSessionId: string;
  createdAt: number;
}

export interface IResetPasswordEmailCache {
  userId: string;
}

export interface IEmailCodeCache {
  code: string;
  // The address the code was mailed to; consuming it must target the same one.
  email: string;
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
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
}

export interface IOAuthDeviceState {
  clientId: string;
  scopes: string[];
  userCode: string;
  status: 'pending' | 'approved' | 'denied';
  /** Set once someone approves in a browser; the next poll turns it into tokens. */
  user?: {
    id: string;
    name: string;
    email: string;
  };
  /** Epoch ms the code dies at, so rewriting the state cannot extend its life. */
  expiresAt: number;
}

export interface IOAuthTxnStore {
  redirectURI: string;
  clientId: string;
  type: string;
  scopes: string[];
  userId: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

export enum OperationName {
  CreateView = 'createView',
  DeleteView = 'deleteView',
  UpdateView = 'updateView',
  CreateRecords = 'createRecords',
  DeleteRecords = 'deleteRecords',
  ArchiveRecords = 'archiveRecords',
  UpdateRecords = 'updateRecords',
  UpdateRecordsOrder = 'updateRecordsOrder',
  CreateFields = 'createFields',
  ConvertField = 'convertField',
  ConvertFieldV2 = 'convertFieldV2',
  DeleteFields = 'deleteFields',
  PasteSelection = 'pasteSelection',
}

export interface IUndoRedoOperationBase {
  name: OperationName;
  params: Record<string, unknown>;
  result?: unknown;
  userId?: string;
  operationId?: string;
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

// The archived snapshots stay in record_trash (write-ahead), so the stack entry only
// carries ids: undo restores the rows matched by operationId, redo re-archives by id.
export interface IArchiveRecordsOperation extends IUndoRedoOperationBase {
  name: OperationName.ArchiveRecords;
  params: {
    tableId: string;
  };
  result: {
    recordIds: string[];
  };
  operationId: string;
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

export interface IConvertFieldV2Operation extends IUndoRedoOperationBase {
  name: OperationName.ConvertFieldV2;
  params: {
    tableId: string;
  };
  result: {
    oldField: IFieldVo;
    newField: IFieldVo;
    modifiedOps?: IOpsMap;
    references?: string[];
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
  | IArchiveRecordsOperation
  | IUpdateRecordsOrderOperation
  | ICreateFieldsOperation
  | IDeleteFieldsOperation
  | IConvertFieldOperation
  | IConvertFieldV2Operation
  | IPasteSelectionOperation
  | ICreateViewOperation
  | IDeleteViewOperation
  | IUpdateViewOperation;
export interface IPluginAuthStore {
  baseId: string;
  pluginId: string;
}

export interface ICollaboratorNotifyPending {
  fromUserId: string;
  toUserId: string;
  refRecord: {
    baseId: string;
    tableId: string;
    tableName: string;
    fieldName: string;
    recordIds: string[];
    recordTitles: { id: string; title: string }[];
  };
  lastAt: number;
}
