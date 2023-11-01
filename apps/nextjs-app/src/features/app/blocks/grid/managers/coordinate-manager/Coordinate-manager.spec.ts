/* eslint-disable @typescript-eslint/no-explicit-any */
import { CoordinateManager } from './CoordinateManager';
import type { ICoordinate } from './interface';
import { ItemType } from './interface';

const mockedCoordinate: ICoordinate = {
  rowCount: 100,
  pureRowCount: 100,
  columnCount: 100,
  containerWidth: 1000,
  containerHeight: 500,
  rowHeight: 50,
  columnWidth: 50,
  rowHeightMap: { 0: 60, 2: 70 },
  columnWidthMap: { 0: 60, 2: 70 },
  rowInitSize: 40,
  columnInitSize: 70,
  freezeColumnCount: 1,
};

describe('CoordinateManager', () => {
  let coordinateManager: CoordinateManager;

  beforeEach(() => {
    coordinateManager = new CoordinateManager(mockedCoordinate);
  });

  test('getColumnOffset', () => {
    expect(coordinateManager.getColumnOffset(1)).toBe(130);
    expect(coordinateManager.getColumnOffset(2)).toBe(180);
  });

  test('getRowOffset', () => {
    expect(coordinateManager.getRowOffset(1)).toBe(100);
    expect(coordinateManager.getRowOffset(2)).toBe(150);
  });

  test('getColumnStartIndex', () => {
    expect(coordinateManager.getColumnStartIndex(1000)).toBe(18);
  });

  test('getColumnStopIndex', () => {
    expect(coordinateManager.getColumnStopIndex(10, 1000)).toBe(37);
  });

  test('getRowStartIndex', () => {
    expect(coordinateManager.getRowStartIndex(500)).toBe(8);
  });

  test('getRowStopIndex', () => {
    expect(coordinateManager.getRowStopIndex(10, 1000)).toBe(28);
  });

  test('findNearestCellIndex', () => {
    expect(coordinateManager.findNearestCellIndex(300, ItemType.Row)).toBe(4);
    expect(coordinateManager.findNearestCellIndex(300, ItemType.Column)).toBe(4);
  });

  test('getCellMetaData', () => {
    const rowMetaData = (coordinateManager as any).getCellMetaData(2, ItemType.Row);
    const columnMetaData = (coordinateManager as any).getCellMetaData(2, ItemType.Column);
    expect(rowMetaData.size).toBe(70);
    expect(rowMetaData.offset).toBe(150);
    expect(columnMetaData.size).toBe(70);
    expect(columnMetaData.offset).toBe(180);
  });

  test('rowHeight', () => {
    expect(coordinateManager.rowHeight).toBe(50);
    coordinateManager.rowHeight = 100;
    expect(coordinateManager.rowHeight).toBe(100);
  });

  test('columnWidth', () => {
    expect(coordinateManager.columnWidth).toBe(50);
    coordinateManager.columnWidth = 100;
    expect(coordinateManager.columnWidth).toBe(100);
  });

  test('getColumnWidth', () => {
    expect(coordinateManager.getColumnWidth(0)).toBe(60);
    expect(coordinateManager.getColumnWidth(1)).toBe(50);
    expect(coordinateManager.getColumnWidth(2)).toBe(70);
  });

  test('getRowHeight', () => {
    expect(coordinateManager.getRowHeight(0)).toBe(60);
    expect(coordinateManager.getRowHeight(1)).toBe(50);
    expect(coordinateManager.getRowHeight(2)).toBe(70);
  });

  test('freezeRegionWidth', () => {
    expect(coordinateManager.freezeRegionWidth).toBe(130);
  });

  test('totalHeight', () => {
    expect(coordinateManager.totalHeight).toBe(5070);
  });

  test('totalWidth', () => {
    expect(coordinateManager.totalWidth).toBe(5100);
  });
});
