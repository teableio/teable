import type { IOtOperation, ISnapshotBase } from '@teable-group/core';
import type { DB } from 'sharedb';
export interface IAdapterService {
  create(collectionId: string, snapshot: unknown): Promise<void>;

  del(collectionId: string, docId: string): Promise<void>;

  update(
    version: number,
    collectionId: string,
    docId: string,
    opContexts: unknown[]
  ): Promise<void>;

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

export interface ISupplementService {
  createForeignKey(collectionId: string, snapshot: unknown): Promise<unknown>;
}

export interface IShareDbConfig {
  db: DB;
}

export interface IRawOp {
  src: string;
  seq: number;
  op: IOtOperation[];
  v: number;
  m: {
    ts: number;
  };
  c?: string;
  d?: string;
}

export interface IRawOpMap {
  [tableId: string]: {
    [recordId: string]: IRawOp;
  };
}
