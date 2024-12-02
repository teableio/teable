import { useTheme } from '@teable/next-themes';
import colors from 'tailwindcss/colors';
import type { IGridTheme } from '../../grid/configs';
import { hexToRGBA } from '../../grid/utils';

const lightTheme = {} as IGridTheme;

const darkTheme = {
  // Common
  iconFgCommon: colors.slate[50],

  // Cell
  cellBg: '#09090b',
  cellBgHovered: colors.neutral[900],
  cellBgSelected: colors.zinc[900],
  cellBgLoading: colors.zinc[800],
  cellLineColor: '#333338',
  cellLineColorActived: colors.zinc[400],
  cellTextColor: colors.zinc[50],
  cellOptionBg: colors.zinc[700],
  cellOptionTextColor: colors.white,

  // Group Header
  groupHeaderBgPrimary: colors.neutral[900],
  groupHeaderBgSecondary: colors.neutral[800],
  groupHeaderBgTertiary: colors.neutral[700],

  // Column Header
  columnHeaderBg: colors.neutral[900],
  columnHeaderBgHovered: colors.neutral[800],
  columnHeaderBgSelected: colors.neutral[700],
  columnHeaderNameColor: colors.slate[50],
  columnResizeHandlerBg: colors.zinc[500],
  columnDraggingPlaceholderBg: hexToRGBA(colors.white, 0.2),

  // Column Statistic
  columnStatisticBgHovered: colors.zinc[800],

  // Row Header
  rowHeaderTextColor: colors.zinc[50],

  // Append Row
  appendRowBg: colors.neutral[900],
  appendRowBgHovered: colors.neutral[800],

  // Avatar
  avatarBg: colors.zinc[900],
  avatarTextColor: colors.zinc[100],
  avatarSizeXS: 16,
  avatarSizeSM: 20,
  avatarSizeMD: 24,

  themeKey: 'dark',

  // ScrollBar
  scrollBarBg: colors.zinc[700],

  // interaction
  interactionLineColorCommon: colors.zinc[600],
  interactionLineColorHighlight: colors.violet[700],

  // search cursor
  searchCursorBg: colors.orange[400],
  searchTargetIndexBg: colors.yellow[700],

  // comment
  commentCountBg: colors.orange[400],
  commentCountTextColor: colors.white,
} as IGridTheme;

export function useGridTheme(): IGridTheme {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? darkTheme : lightTheme;
}
