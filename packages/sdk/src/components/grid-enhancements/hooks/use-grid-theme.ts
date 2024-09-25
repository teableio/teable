import { useTheme } from '@teable/next-themes';
import colors from 'tailwindcss/colors';
import type { IGridTheme } from '../../grid/configs';
import { hexToRGBA } from '../../grid/utils';

const lightTheme = {} as IGridTheme;

const darkTheme = {
  // Common
  iconFgCommon: colors.slate[50],

  // Cell
  cellBg: '#030712',
  cellBgHovered: colors.zinc[900],
  cellBgSelected: colors.gray[800],
  cellBgLoading: colors.slate[800],
  cellLineColor: colors.gray[700],
  cellLineColorActived: colors.slate[400],
  cellTextColor: colors.slate[50],
  cellOptionBg: colors.gray[600],
  cellOptionTextColor: colors.white,

  // Group Header
  groupHeaderBgPrimary: colors.zinc[900],
  groupHeaderBgSecondary: colors.zinc[800],
  groupHeaderBgTertiary: colors.zinc[700],

  // Column Header
  columnHeaderBg: colors.zinc[900],
  columnHeaderBgHovered: colors.zinc[800],
  columnHeaderBgSelected: colors.zinc[700],
  columnHeaderNameColor: colors.slate[50],
  columnResizeHandlerBg: colors.gray[400],
  columnDraggingPlaceholderBg: hexToRGBA(colors.white, 0.2),

  // Column Statistic
  columnStatisticBgHovered: colors.gray[800],

  // Row Header
  rowHeaderTextColor: colors.slate[50],

  // Append Row
  appendRowBg: colors.zinc[900],
  appendRowBgHovered: colors.zinc[800],

  // Avatar
  avatarBg: colors.gray[800],
  avatarTextColor: colors.gray[50],
  avatarSizeXS: 16,
  avatarSizeSM: 20,
  avatarSizeMD: 24,

  themeKey: 'dark',

  // ScrollBar
  scrollBarBg: colors.gray[600],

  // interaction
  interactionLineColorCommon: colors.gray[500],
  interactionLineColorHighlight: colors.violet[700],
} as IGridTheme;

export function useGridTheme(): IGridTheme {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? darkTheme : lightTheme;
}
