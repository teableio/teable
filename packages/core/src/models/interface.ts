import type { ITableVo } from './table/interface';

export interface IFileNode {
  name: string;
  path: string;
  isDirectory?: boolean;
  type: string;
  children?: IFileNode[];
}

export interface ITeable {
  id: string;
  name: string;
  description: string;
  schemaVersion: string;
  tableList: string[];
  schema: {
    [tableId: string]: ITableVo;
  };
}

export interface ISnapshotBase<T = unknown> {
  id: string;
  v: number;
  type: string | null;
  data: T;
  m?: unknown;
}
