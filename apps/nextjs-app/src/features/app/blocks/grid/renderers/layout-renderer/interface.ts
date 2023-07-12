import type { IGridTheme } from '../../configs';
import type { IColumn, RowControlType } from '../../interface';
import type { SpriteManager } from '../../managers';
import type { IInnerCell } from '../cell-renderer';

export interface ICellPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ICellDrawerProps extends ICellPosition {
  cell: IInnerCell;
  theme: IGridTheme;
  fill?: string;
  stroke?: string;
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
