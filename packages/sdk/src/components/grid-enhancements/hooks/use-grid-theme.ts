import colors from 'tailwindcss/colors';
import { ThemeKey } from '../../../context';
import { useTheme } from '../../../hooks/use-theme';
import { hexToRGBA } from '../../grid/utils';

const lightTheme = {};

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

  // Column Header
  columnHeaderBg: colors.zinc[900],
  columnHeaderBgHovered: colors.zinc[800],
  columnHeaderBgSelected: colors.zinc[700],
  columnHeaderNameColor: colors.slate[50],
  columnResizeHandlerBg: colors.gray[100],
  columnDraggingPlaceholderBg: hexToRGBA(colors.white, 0.2),

  // Row Header
  rowHeaderTextColor: colors.slate[50],

  // Append Row
  appendRowBg: colors.zinc[900],
  appendRowBgHovered: colors.zinc[800],
};

export function useGridTheme() {
  const { theme } = useTheme();
  return theme === ThemeKey.Dark ? darkTheme : lightTheme;
}
