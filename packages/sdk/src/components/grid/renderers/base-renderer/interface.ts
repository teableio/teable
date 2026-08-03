import type { IRectangle } from '../../interface';

export interface IPoint {
  x: number;
  y: number;
  radius?: number;
}

export interface IVector {
  nx: number;
  ny: number;
  len: number;
  x: number;
  y: number;
  ang: number;
}

interface ICornerRadius {
  tl: number;
  tr: number;
  bl: number;
  br: number;
}

export interface IRectProps extends IRectangle {
  fill?: string;
  stroke?: string;
  radius?: number | ICornerRadius;
  opacity?: number;
}

export interface IRoundPolyProps {
  points: IPoint[];
  radiusAll: number;
  fill?: string;
  stroke?: string;
}

export interface ICheckboxProps {
  x: number;
  y: number;
  size: number;
  fill?: string;
  stroke?: string;
  radius?: number;
  isChecked?: boolean;
}

export interface ILineProps {
  x: number;
  y: number;
  points: number[];
  lineWidth?: number;
  stroke?: string;
  closed?: boolean;
}

export interface ITextBaseProps {
  text: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold' | 'bolder' | 'lighter';
  textAlign?: 'left' | 'right' | 'center' | 'start' | 'end';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  isUnderline?: boolean;
}

export interface ISingleLineTextProps extends ITextBaseProps {
  x?: number;
  y?: number;
  fill?: string;
  maxWidth?: number;
  needSetFont?: boolean;
  needRender?: boolean;
}

export interface IMultiLineTextProps extends ITextBaseProps {
  x?: number;
  y?: number;
  maxWidth: number;
  maxLines: number;
  fill?: string;
  lineHeight?: number;
  needRender?: boolean;
}

export interface IRingProps {
  x: number;
  y: number;
  radius: number;
  value: number;
  maxValue: number;
  color: string;
  lineWidth?: number;
}

export interface IProcessBarProps extends IRectangle {
  value: number;
  maxValue: number;
  color: string;
  radius?: number;
}

export interface IChartLineProps extends IRectangle {
  values: number[];
  color: string;
  axisColor: string;
  font: string;
  hoverX?: number;
  hoverAmount?: number;
  yAxis?: [number, number];
  displayValues?: string[];
}

export type IChartBarProps = Omit<IChartLineProps, 'hoverAmount'>;

export interface ITextInfo {
  text: string;
  width: number;
}

export interface IAvatarProps extends IRectangle {
  defaultText: string;
  img?: HTMLImageElement | ImageBitmap;
  fill?: string;
  stroke?: string;
  fontSize?: number;
  textColor?: string;
  fontFamily: string;
}
