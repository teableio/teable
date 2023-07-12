import type { IIndicesMap, ICoordinate, ICellMetaData, ICellMetaDataMap } from './interface';
import { RowHeightLevel, ItemType } from './interface';

export class CoordinateManager {
  protected defaultRowHeight: number;
  protected defaultColumnWidth: number;
  public pureRowCount: number;
  public rowCount: number;
  public columnCount: number;
  public containerWidth: number;
  public containerHeight: number;
  public rowHeightMap: IIndicesMap = {};
  public columnWidthMap: IIndicesMap = {};
  public rowInitSize: number;
  public columnInitSize: number;
  public lastRowIndex = -1;
  public lastColumnIndex = -1;
  public rowMetaDataMap: ICellMetaDataMap = {};
  public columnMetaDataMap: ICellMetaDataMap = {};
  public rowHeightLevel: RowHeightLevel;
  public freezeColumnCount: number;

  constructor({
    rowHeight,
    columnWidth,
    rowCount,
    pureRowCount,
    columnCount,
    containerWidth,
    containerHeight,
    rowInitSize = 0,
    columnInitSize = 0,
    rowHeightMap = {},
    columnWidthMap = {},
    rowHeightLevel = RowHeightLevel.Short,
    freezeColumnCount = 1,
  }: ICoordinate) {
    this.defaultRowHeight = rowHeight;
    this.defaultColumnWidth = columnWidth;
    this.rowHeightLevel = rowHeightLevel;
    this.rowCount = rowCount;
    this.pureRowCount = pureRowCount;
    this.columnCount = columnCount;
    this.rowInitSize = rowInitSize;
    this.columnInitSize = columnInitSize;
    this.containerWidth = containerWidth;
    this.containerHeight = containerHeight;
    this.rowHeightMap = rowHeightMap;
    this.columnWidthMap = columnWidthMap;
    this.freezeColumnCount = freezeColumnCount;
  }

  public get freezeRegionWidth() {
    return this.getColumnOffset(this.freezeColumnCount);
  }

  public get columnWidth() {
    return this.defaultColumnWidth;
  }

  public set columnWidth(width: number) {
    this.defaultColumnWidth = width;
  }

  public get rowHeight() {
    return this.defaultRowHeight;
  }

  public set rowHeight(height: number) {
    this.defaultRowHeight = height;
  }

  public get totalWidth() {
    const { offset, size } = this.getCellMetaData(this.columnCount - 1, ItemType.Column);
    return offset + size;
  }

  public get totalHeight() {
    const { offset, size } = this.getCellMetaData(this.rowCount - 1, ItemType.Row);
    return offset + size;
  }

  public getRowHeight(index: number) {
    return this.rowMetaDataMap[index]?.size ?? this.defaultRowHeight;
  }

  public getColumnWidth(index: number) {
    return this.columnMetaDataMap[index]?.size ?? this.defaultColumnWidth;
  }

  protected getCellMetaData(index: number, itemType: ItemType): ICellMetaData {
    let cellMetadataMap, itemSize, lastMeasuredIndex, offset;
    const isColumnType = itemType === ItemType.Column;

    if (isColumnType) {
      itemSize = this.columnWidth;
      offset = this.columnInitSize;
      lastMeasuredIndex = this.lastColumnIndex;
      cellMetadataMap = this.columnMetaDataMap;
    } else {
      itemSize = this.rowHeight;
      offset = this.rowInitSize;
      lastMeasuredIndex = this.lastRowIndex;
      cellMetadataMap = this.rowMetaDataMap;
    }
    if (index > lastMeasuredIndex) {
      if (lastMeasuredIndex >= 0) {
        const itemMetadata = cellMetadataMap[lastMeasuredIndex];
        offset = itemMetadata.offset + itemMetadata.size;
      }

      for (let i = lastMeasuredIndex + 1; i <= index; i++) {
        const size = (isColumnType ? this.columnWidthMap[i] : this.rowHeightMap[i]) ?? itemSize;

        cellMetadataMap[i] = {
          offset,
          size,
        };
        offset += size;
      }
      if (isColumnType) {
        this.lastColumnIndex = index;
      } else {
        this.lastRowIndex = index;
      }
    }
    return cellMetadataMap[index] || { size: 0, offset: 0 };
  }

  /**
   * Find the nearest cell index
   * Poor performance, but can be found in any case
   */
  private findNearestCellIndexLinear(index: number, offset: number, itemType: ItemType) {
    const itemCount = itemType === ItemType.Column ? this.columnCount : this.rowCount;
    let interval = 1;

    while (index < itemCount && this.getCellMetaData(index, itemType).offset < offset) {
      index += interval;
      interval *= 2;
    }

    return this.findNearestCellIndexBinary(
      offset,
      Math.floor(index / 2),
      Math.min(index, itemCount - 1),
      itemType
    );
  }

  /**
   * Dichotomy to find the nearest cell index
   * Better performance, but requires data to be loaded
   */
  private findNearestCellIndexBinary(
    offset: number,
    low: number,
    high: number,
    itemType: ItemType
  ) {
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const currentOffset = this.getCellMetaData(middle, itemType).offset;

      if (currentOffset === offset) {
        return middle;
      } else if (currentOffset < offset) {
        low = middle + 1;
      } else if (currentOffset > offset) {
        high = middle - 1;
      }
    }
    return low > 0 ? low - 1 : 0;
  }

  public findNearestCellIndex(offset: number, itemType: ItemType) {
    let itemMetadataMap, lastIndex;

    if (itemType === ItemType.Column) {
      itemMetadataMap = this.columnMetaDataMap;
      lastIndex = this.lastColumnIndex;
    } else {
      itemMetadataMap = this.rowMetaDataMap;
      lastIndex = this.lastRowIndex;
    }
    const lastMeasuredItemOffset = lastIndex > 0 ? itemMetadataMap[lastIndex].offset : 0;

    if (lastMeasuredItemOffset >= offset) {
      return this.findNearestCellIndexBinary(offset, 0, lastIndex, itemType);
    }
    return this.findNearestCellIndexLinear(Math.max(0, lastIndex), offset, itemType);
  }

  public getRowStartIndex(scrollTop: number) {
    return this.findNearestCellIndex(scrollTop, ItemType.Row);
  }

  public getRowStopIndex(startIndex: number, scrollTop: number) {
    const itemMetadata = this.getCellMetaData(startIndex, ItemType.Row);
    const maxOffset = scrollTop + this.containerHeight;
    let offset = itemMetadata.offset + itemMetadata.size;
    let stopIndex = startIndex;

    while (stopIndex < this.rowCount - 1 && offset < maxOffset) {
      stopIndex++;
      offset += this.getCellMetaData(stopIndex, ItemType.Row).size;
    }
    return stopIndex;
  }

  public getColumnStartIndex(scrollLeft: number) {
    return this.findNearestCellIndex(scrollLeft, ItemType.Column);
  }

  public getColumnStopIndex(startIndex: number, scrollLeft: number) {
    const itemMetadata = this.getCellMetaData(startIndex, ItemType.Column);
    const maxOffset = scrollLeft + this.containerWidth;
    let offset = itemMetadata.offset + itemMetadata.size;
    let stopIndex = startIndex;

    while (stopIndex < this.columnCount - 1 && offset < maxOffset) {
      stopIndex++;
      offset += this.getCellMetaData(stopIndex, ItemType.Column).size;
    }
    return stopIndex;
  }

  public getRowOffset(rowIndex: number) {
    return this.getCellMetaData(rowIndex, ItemType.Row).offset;
  }

  public getColumnOffset(columnIndex: number) {
    return this.getCellMetaData(columnIndex, ItemType.Column).offset;
  }
}
