import colors from 'tailwindcss/colors';
import { hexToRGBA } from '../utils';

export interface IGridTheme {
  staticWhite: string;
  staticBlack: string;
  iconBgCommon: string;
  iconFgCommon: string;
  iconBgSelected: string;
  iconFgSelected: string;
  iconSizeXS: number;
  iconSizeSM: number;
  iconSizeMD: number;
  iconSizeLG: number;
  fontSizeXS: number;
  fontSizeSM: number;
  fontSizeMD: number;
  fontSizeLG: number;
  fontFamily: string;
  cellBg: string;
  cellBgHovered: string;
  cellBgSelected: string;
  cellBgLoading: string;
  cellLineColor: string;
  cellLineColorActived: string;
  cellTextColor: string;
  cellHorizontalPadding: number;
  cellVerticalPadding: number;
  cellOptionBg: string;
  cellOptionTextColor: string;
  columnHeaderBg: string;
  columnHeaderBgHovered: string;
  columnHeaderBgSelected: string;
  columnHeaderNameColor: string;
  columnResizeHandlerBg: string;
  columnDraggingPlaceholderBg: string;
  rowHeaderTextColor: string;
  appendRowBg: string;
  appendRowBgHovered: string;
}

export const gridTheme: IGridTheme = {
  // Common
  staticWhite: '#FFFFFF',
  staticBlack: '#000000',
  iconBgCommon: colors.gray[500],
  iconFgCommon: colors.blue[500],
  iconBgSelected: colors.black,
  iconFgSelected: colors.blue[50],
  iconSizeXS: 16,
  iconSizeSM: 20,
  iconSizeMD: 24,
  iconSizeLG: 32,
  fontSizeXS: 12,
  fontSizeSM: 13,
  fontSizeMD: 14,
  fontSizeLG: 16,
  fontFamily:
    'Inter, Roboto, -apple-system, BlinkMacSystemFont, avenir next, avenir, segoe ui, helvetica neue, helvetica, Ubuntu, noto, arial, sans-serif',

  // Cell
  cellBg: colors.white,
  cellBgHovered: colors.slate[100],
  cellBgSelected: colors.zinc[100],
  cellBgLoading: colors.violet[50],
  cellLineColor: colors.slate[200],
  cellLineColorActived: colors.zinc[800],
  cellTextColor: colors.zinc[800],
  cellHorizontalPadding: 8,
  cellVerticalPadding: 3,
  cellOptionBg: colors.gray[500],
  cellOptionTextColor: colors.white,

  // Column Header
  columnHeaderBg: colors.slate[50],
  columnHeaderBgHovered: colors.slate[100],
  columnHeaderBgSelected: colors.slate[200],
  columnHeaderNameColor: colors.zinc[800],
  columnResizeHandlerBg: colors.zinc[800],
  columnDraggingPlaceholderBg: hexToRGBA(colors.black, 0.2),

  // Row Header
  rowHeaderTextColor: colors.gray[500],

  // Append Row
  appendRowBg: colors.slate[50],
  appendRowBgHovered: colors.slate[100],
};
