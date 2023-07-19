import type { IGridTheme } from '../../configs';
import type { IColumn, RowControlType } from '../../interface';
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
  fill?: string;
  stroke?: string;
  isChecked?: boolean;
  rowControls?: RowControlType[];
}

export interface IFieldHeadDrawerProps extends ICellPosition {
  column: IColumn;
  theme: IGridTheme;
  spriteManager: SpriteManager;
  fill?: string;
  hasMenu?: boolean;
}

export enum RenderRegion {
  Freeze = 'Freeze',
  Other = 'Other',
}
