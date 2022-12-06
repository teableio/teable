import type { ITable } from './table/interface';

export type IFileNode = {
  name: string;
  path: string;
  isDirectory?: boolean;
  type: string;
  children?: IFileNode[];
};

export interface ITeable {
  id: string;
  name: string;
  description: string;
  schemaVersion: string;
  tableList: string[];
  schema: {
    [tableId: string]: ITable;
  };
}
