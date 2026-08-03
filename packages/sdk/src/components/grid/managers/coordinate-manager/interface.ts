export interface ICoordinate {
  rowCount: number;
  pureRowCount: number;
  columnCount: number;
  containerWidth: number;
  containerHeight: number;
  rowHeight: number;
  columnWidth: number;
  rowHeightMap?: IIndicesMap;
  columnWidthMap?: IIndicesMap;
  rowInitSize?: number;
  columnInitSize?: number;
  freezeColumnCount?: number;
}

export type IIndicesMap = Record<number, number>;

export type ICellMetaDataMap = Record<number, ICellMetaData>;

export enum ItemType {
  Row = 'Row',
  Column = 'Column',
}

export type ICellMetaData = {
  size: number;
  offset: number;
};
