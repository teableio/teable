import { ThemeKey, useTheme } from '@teable-group/sdk';

const lightTheme = {};

const darkTheme = {
  // Common
  iconBgCommon: '#F9F9F9',
  iconBgSelected: '#306FD9',

  // Cell
  cellBg: '#030711',
  cellBgHovered: '#23232c',
  cellBgSelected: '#1c283a',
  cellBgLoading: 'rgba(202, 206, 255, 0.253)',
  cellLineColor: 'rgba(225,225,225,0.2)',
  cellLineColorActived: '#306FD9',
  cellTextColor: '#F9F9F9',

  // Column Header
  columnHeaderBgHovered: '#23232c',
  columnHeaderBgSelected: '#1c283a',
  columnHeaderNameColor: '#F9F9F9',
  columnResizeHandlerBg: '#306FD9',
  columnDraggingPlaceholderBg: 'rgba(0, 0, 0, 0.2)',

  // Row Header
  rowHeaderTextColor: '#F9F9F9',
};

export function useGridTheme() {
  const { theme } = useTheme();
  return theme === ThemeKey.Dark ? darkTheme : lightTheme;
}
