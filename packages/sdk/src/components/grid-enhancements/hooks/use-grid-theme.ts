import { useTheme } from '@teable/next-themes';
import colors from 'tailwindcss/colors';
import type { IGridTheme } from '../../grid/configs';
import { hexToRGBA } from '../../grid/utils';

const lightTheme = {} as IGridTheme;

const darkTheme = {
  // Common
  iconFgCommon: colors.slate[50],

  // Cell
  cellBg: '#121314',
  cellBgHovered: '#1C1E1F',
  cellBgSelected: '#242426',
  cellBgLoading: colors.zinc[800],
  cellLineColor: hexToRGBA(colors.white, 0.1),
  cellLineColorActived: colors.zinc[400],
  cellTextColor: colors.zinc[200],
  cellOptionBg: colors.zinc[700],
  cellOptionTextColor: colors.zinc[200],

  // Group Header
  groupHeaderBgPrimary: '#17181A',
  groupHeaderBgSecondary: '#1D1D1F',
  groupHeaderBgTertiary: '#252526',

  // Column Header
  columnHeaderBg: '#1C1D1F',
  columnHeaderBgHovered: '#242426',
  columnHeaderBgSelected: '#2C2D2E',
  columnHeaderNameColor: colors.zinc[200],
  columnResizeHandlerBg: colors.zinc[500],
  columnDraggingPlaceholderBg: hexToRGBA(colors.white, 0.2),

  // Column Statistic
  columnStatisticBgHoveredPrimary: '#262729',
  columnStatisticBgHoveredSecondary: '#2C2C2E',
  columnStatisticBgHoveredTertiary: '#323233',

  // Row Header
  rowHeaderTextColor: colors.zinc[200],

  // Append Row
  appendRowBg: colors.zinc[900],
  appendRowBgHovered: colors.zinc[800],

  // Avatar
  avatarBg: colors.zinc[900],
  avatarTextColor: colors.zinc[200],
  avatarSizeXS: 16,
  avatarSizeSM: 20,
  avatarSizeMD: 24,

  themeKey: 'dark',

  // ScrollBar
  scrollBarBg: colors.zinc[700],

  // interaction
  interactionLineColorCommon: colors.zinc[700],
  interactionLineColorHighlight: colors.blue[500],

  // search cursor
  searchCursorBg: '#243854',
  searchTargetIndexBg: '#172231',

  // comment
  commentCountBg: colors.orange[400],
  commentCountTextColor: colors.zinc[900],
} as IGridTheme;

export function useGridTheme(): IGridTheme {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? darkTheme : lightTheme;
}
