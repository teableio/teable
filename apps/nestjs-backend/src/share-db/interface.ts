import type { ISnapshotBase } from '@teable/core';
import type { CreateOp, DB, DeleteOp, EditOp } from 'sharedb';

export interface IReadonlyAdapterService {
  getSnapshotBulk(
    collectionId: string,
    ids: string[],
    projection?: { [fieldNameOrId: string]: boolean },
    extra?: unknown
  ): Promise<ISnapshotBase<unknown>[]>;

  getDocIdsByQuery(
    collectionId: string,
    query: unknown
  ): Promise<{ ids: string[]; extra?: unknown }>;
}

export interface IShareDbReadonlyAdapterService extends IReadonlyAdapterService {
  // get current version and type of the document
  getVersionAndType(
    collectionId: string,
    docId: string
  ): Promise<{ version: number; type: RawOpType }>;
}

export interface IAdapterService {
  create(collectionId: string, snapshot: unknown): Promise<void>;

  del(version: number, collectionId: string, docId: string): Promise<void>;

  update(
    version: number,
    collectionId: string,
    docId: string,
    opContexts: unknown[]
  ): Promise<void>;
}

export interface IShareDbConfig {
  db: DB;
}

export enum RawOpType {
  Create = 'create',
  Del = 'del',
  Edit = 'edit',
}

export type IEditOp = Omit<EditOp, 'c' | 'd' | 'create' | 'del'>;
export type IDeleteOp = Omit<DeleteOp, 'c' | 'd' | 'create' | 'op'>;
export type ICreateOp = Omit<CreateOp, 'c' | 'd' | 'op' | 'del'>;

export type IRawOp = ICreateOp | IDeleteOp | IEditOp;

export interface IRawOpMap {
  [collection: string]: {
    [docId: string]: IRawOp;
  };
}
