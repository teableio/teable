import type { IGridTheme } from '../../configs';
import type { IGridColumn, RowControlType } from '../../interface';
import type { ImageManager, SpriteManager } from '../../managers';
import type { ICell } from '../cell-renderer';

export interface ICellPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ICellDrawerProps extends ICellPosition {
  cell: ICell;
  theme: IGridTheme;
  fill?: string;
  stroke?: string;
  isActive?: boolean;
  rowIndex: number;
  columnIndex: number;
  imageManager: ImageManager;
}

export interface IRowHeaderDrawerProps extends ICellPosition {
  displayIndex: string;
  theme: IGridTheme;
  isHover: boolean;
  rowControls: RowControlType[];
  spriteManager: SpriteManager;
  fill?: string;
  stroke?: string;
  isChecked?: boolean;
}

export interface IFieldHeadDrawerProps extends ICellPosition {
  column: IGridColumn;
  theme: IGridTheme;
  spriteManager: SpriteManager;
  fill?: string;
  hasMenu?: boolean;
}

export enum RenderRegion {
  Freeze = 'Freeze',
  Other = 'Other',
}
