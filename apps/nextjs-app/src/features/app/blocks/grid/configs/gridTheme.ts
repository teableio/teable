export interface IGridTheme {
  staticWhite: string;
  staticBlack: string;
  iconSizeSM: number;
  iconSizeMD: number;
  iconSizeLG: number;
  fontSizeSM: number;
  fontSizeMD: number;
  fontSizeLG: number;
  fontFamily: string;
  cellBg: string;
  cellBgHovered: string;
  cellBgSelected: string;
  cellLineColor: string;
  cellLineColorActived: string;
  cellTextColor: string;
  cellHorizontalPadding: number;
  cellVerticalPadding: number;
  columnHeaderBgHovered: string;
  columnHeaderBgSelected: string;
  columnHeaderMenuBg: string;
  columnHeaderNameColor: string;
  columnResizeHandlerBg: string;
  columnDraggingPlaceholderBg: string;
  rowHeaderTextColor: string;
}

export const gridTheme: IGridTheme = {
  // Common
  staticWhite: '#FFFFFF',
  staticBlack: '#000000',
  iconSizeSM: 16,
  iconSizeMD: 24,
  iconSizeLG: 32,
  fontSizeSM: 12,
  fontSizeMD: 13,
  fontSizeLG: 14,
  fontFamily:
    'Inter, Roboto, -apple-system, BlinkMacSystemFont, avenir next, avenir, segoe ui, helvetica neue, helvetica, Ubuntu, noto, arial, sans-serif',

  // Cell
  cellBg: '#FFFFFF',
  cellBgHovered: '#F5F7FA',
  cellBgSelected: '#F2F6FE',
  cellLineColor: '#E0E0E0',
  cellLineColorActived: '#306FD9',
  cellTextColor: '#262626',
  cellHorizontalPadding: 8,
  cellVerticalPadding: 3,

  // Column Header
  columnHeaderBgHovered: '#F5F7FA',
  columnHeaderBgSelected: '#F2F6FE',
  columnHeaderMenuBg: '#636363',
  columnHeaderNameColor: '#262626',
  columnResizeHandlerBg: '#306FD9',
  columnDraggingPlaceholderBg: 'rgba(0, 0, 0, 0.2)',

  // Row Header
  rowHeaderTextColor: '#636363',
};
