import type { IGridTheme } from '../../configs';
import type { IGridColumn, IRowControlItem } from '../../interface';
import type { ImageManager, SpriteManager } from '../../managers';
import type { IRenderLayerProps } from '../../RenderLayer';
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
  rowControls: IRowControlItem[];
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

export interface IAppendColumnDrawerProps extends ICellPosition {
  theme: IGridTheme;
  isHover: boolean;
  isColumnAppendEnable?: boolean;
}

export interface IGridHeaderDrawerProps extends ICellPosition {
  theme: IGridTheme;
  isChecked: boolean;
  rowControls: IRowControlItem[];
}

export enum RenderRegion {
  Freeze = 'Freeze',
  Other = 'Other',
}

export interface ILayoutDrawerProps extends IRenderLayerProps {
  shouldRebuild?: boolean;
}
