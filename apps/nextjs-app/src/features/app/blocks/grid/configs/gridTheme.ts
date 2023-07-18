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
  columnHeaderBgHovered: string;
  columnHeaderBgSelected: string;
  columnHeaderNameColor: string;
  columnResizeHandlerBg: string;
  columnDraggingPlaceholderBg: string;
  rowHeaderTextColor: string;
}

export const gridTheme: IGridTheme = {
  // Common
  staticWhite: '#FFFFFF',
  staticBlack: '#000000',
  iconBgCommon: '#737383',
  iconFgCommon: '#009CA6',
  iconBgSelected: '#FFFFFF',
  iconFgSelected: '#4F5DFF',
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
  cellBg: '#FFFFFF',
  cellBgHovered: '#F5F7FA',
  cellBgSelected: '#F2F6FE',
  cellBgLoading: 'rgba(202, 206, 255, 0.253)',
  cellLineColor: '#E0E0E0',
  cellLineColorActived: '#306FD9',
  cellTextColor: '#262626',
  cellHorizontalPadding: 8,
  cellVerticalPadding: 3,
  cellOptionBg: '#666666',
  cellOptionTextColor: '#FFFFFF',

  // Column Header
  columnHeaderBgHovered: '#F5F7FA',
  columnHeaderBgSelected: '#F2F6FE',
  columnHeaderNameColor: '#262626',
  columnResizeHandlerBg: '#306FD9',
  columnDraggingPlaceholderBg: 'rgba(0, 0, 0, 0.2)',

  // Row Header
  rowHeaderTextColor: '#636363',
};
