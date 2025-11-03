import { useTheme } from '@teable/next-themes';
import colors from 'tailwindcss/colors';
import type { IGridTheme } from '../../grid/configs';
import { hexToRGBA } from '../../grid/utils';

const lightTheme = {} as IGridTheme;

const darkTheme = {
  // Common
  iconFgCommon: colors.slate[100],

  // Cell
  cellBg: '#000000',
  cellBgHovered: '#0a0a0a',
  cellBgSelected: hexToRGBA('#1a1a1a', 0.9),
  cellBgLoading: '#1a1a1a',
  cellLineColor: '#1a1a1a',
  cellLineColorActived: colors.zinc[300],
  cellTextColor: colors.zinc[100],
  cellOptionBg: '#1a1a1a',
  cellOptionTextColor: colors.zinc[100],

  // Group Header
  groupHeaderBgPrimary: '#0a0a0a',
  groupHeaderBgSecondary: '#141414',
  groupHeaderBgTertiary: '#1e1e1e',

  // Column Header
  columnHeaderBg: '#0a0a0a',
  columnHeaderBgHovered: '#141414',
  columnHeaderBgSelected: '#1e1e1e',
  columnHeaderNameColor: colors.slate[100],
  columnResizeHandlerBg: colors.zinc[400],
  columnDraggingPlaceholderBg: hexToRGBA(colors.white, 0.15),

  // Column Statistic
  columnStatisticBgHovered: '#1a1a1a',

  // Row Header
  rowHeaderTextColor: colors.zinc[100],

  // Append Row
  appendRowBg: '#0a0a0a',
  appendRowBgHovered: '#141414',

  // Avatar
  avatarBg: '#1a1a1a',
  avatarTextColor: colors.zinc[100],
  avatarSizeXS: 16,
  avatarSizeSM: 20,
  avatarSizeMD: 24,

  themeKey: 'dark',

  // ScrollBar
  scrollBarBg: '#2a2a2a',

  // interaction
  interactionLineColorCommon: colors.zinc[500],
  interactionLineColorHighlight: colors.violet[600],

  // search cursor
  searchCursorBg: colors.orange[500],
  searchTargetIndexBg: colors.yellow[600],

  // comment
  commentCountBg: colors.orange[500],
  commentCountTextColor: colors.zinc[100],
} as IGridTheme;

export function useGridTheme(): IGridTheme {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? darkTheme : lightTheme;
}
