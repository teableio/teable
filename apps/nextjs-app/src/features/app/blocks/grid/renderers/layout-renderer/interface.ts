import type { IGridTheme } from '../../configs';
import type { ICellPosition, IGridColumn, IRectangle, IRowControlItem } from '../../interface';
import type { ImageManager, SpriteManager } from '../../managers';
import type { IRenderLayerProps } from '../../RenderLayer';

export interface ICellDrawerProps extends IRectangle {
  getCellContent: IRenderLayerProps['getCellContent'];
  theme: IGridTheme;
  fill?: string;
  stroke?: string;
  isActive?: boolean;
  rowIndex: number;
  columnIndex: number;
  imageManager: ImageManager;
  hoverCellPosition: ICellPosition | null;
}

export interface IRowHeaderDrawerProps extends IRectangle {
  displayIndex: string;
  theme: IGridTheme;
  isHover: boolean;
  rowControls: IRowControlItem[];
  spriteManager: SpriteManager;
  fill?: string;
  stroke?: string;
  isChecked?: boolean;
}

export interface IFieldHeadDrawerProps extends IRectangle {
  column: IGridColumn;
  theme: IGridTheme;
  spriteManager: SpriteManager;
  fill?: string;
  hasMenu?: boolean;
}

export interface IAppendColumnDrawerProps extends IRectangle {
  theme: IGridTheme;
  isHover: boolean;
  isColumnAppendEnable?: boolean;
}

export interface IGridHeaderDrawerProps extends IRectangle {
  theme: IGridTheme;
  isChecked: boolean;
  rowControls: IRowControlItem[];
}

export enum RenderRegion {
  Freeze = 'Freeze',
  Other = 'Other',
}

export interface ILayoutDrawerProps extends IRenderLayerProps {
  shouldRerender?: boolean;
}

export interface ICacheDrawerProps {
  containerWidth: number;
  containerHeight: number;
  pixelRatio: number;
  shouldRerender?: boolean;
  draw: (cacheCtx: CanvasRenderingContext2D) => void;
}
