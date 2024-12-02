import colors from 'tailwindcss/colors';
import { hexToRGBA } from '../utils';

export interface IGridTheme {
  staticWhite: string;
  staticBlack: string;
  iconBgCommon: string;
  iconFgCommon: string;
  iconFgHighlight: string;
  iconBgHighlight: string;
  iconBgSelected: string;
  iconFgSelected: string;
  iconSizeXS: number;
  iconSizeSM: number;
  iconSizeMD: number;
  iconSizeLG: number;
  fontSizeXXS: number;
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
  cellTextColorHighlight: string;
  cellOptionBg: string;
  cellOptionBgHighlight: string;
  cellOptionTextColor: string;
  groupHeaderBgPrimary: string;
  groupHeaderBgSecondary: string;
  groupHeaderBgTertiary: string;
  columnHeaderBg: string;
  columnHeaderBgHovered: string;
  columnHeaderBgSelected: string;
  columnHeaderNameColor: string;
  columnResizeHandlerBg: string;
  columnDraggingPlaceholderBg: string;
  columnStatisticBgHovered: string;
  rowHeaderTextColor: string;
  appendRowBg: string;
  appendRowBgHovered: string;
  avatarBg: string;
  avatarTextColor: string;
  avatarSizeXS: number;
  avatarSizeSM: number;
  avatarSizeMD: number;
  themeKey: string;
  scrollBarBg: string;
  interactionLineColorCommon: string;
  interactionLineColorHighlight: string;
  searchCursorBg: string;
  searchTargetIndexBg: string;
  commentCountBg: string;
  commentCountTextColor: string;
}

export const gridTheme: IGridTheme = {
  // Common
  staticWhite: '#FFFFFF',
  staticBlack: '#000000',
  iconFgCommon: colors.gray[500],
  iconBgCommon: colors.transparent,
  iconFgHighlight: colors.yellow[400],
  iconBgHighlight: colors.yellow[400],
  iconFgSelected: colors.blue[50],
  iconBgSelected: colors.black,
  iconSizeXS: 16,
  iconSizeSM: 20,
  iconSizeMD: 24,
  iconSizeLG: 32,
  fontSizeXXS: 10,
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
  cellLineColorActived: colors.black,
  cellTextColor: colors.zinc[800],
  cellTextColorHighlight: colors.violet[500],
  cellOptionBg: colors.gray[300],
  cellOptionBgHighlight: colors.slate[200],
  cellOptionTextColor: colors.black,

  // Group Header
  groupHeaderBgPrimary: colors.slate[50],
  groupHeaderBgSecondary: colors.slate[100],
  groupHeaderBgTertiary: colors.slate[200],

  // Column Header
  columnHeaderBg: colors.slate[50],
  columnHeaderBgHovered: colors.slate[100],
  columnHeaderBgSelected: colors.slate[200],
  columnHeaderNameColor: colors.zinc[800],
  columnResizeHandlerBg: colors.slate[400],
  columnDraggingPlaceholderBg: hexToRGBA(colors.black, 0.2),

  // Column Statistic
  columnStatisticBgHovered: colors.gray[200],

  // Row Header
  rowHeaderTextColor: colors.gray[500],

  // Append Row
  appendRowBg: colors.slate[50],
  appendRowBgHovered: colors.slate[100],

  // Avatar Theme
  avatarBg: colors.gray[100],
  avatarTextColor: colors.gray[950],
  avatarSizeXS: 16,
  avatarSizeSM: 20,
  avatarSizeMD: 24,

  themeKey: 'light',

  // ScrollBar
  scrollBarBg: colors.gray[400],

  // interaction
  interactionLineColorCommon: colors.slate[300],
  interactionLineColorHighlight: colors.violet[500],

  // search cursor
  searchCursorBg: colors.amber[400],
  searchTargetIndexBg: colors.yellow[200],

  // comment
  commentCountBg: colors.orange[400],
  commentCountTextColor: colors.white,
};
