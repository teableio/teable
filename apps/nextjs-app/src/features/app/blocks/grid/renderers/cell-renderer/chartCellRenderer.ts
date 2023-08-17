import { drawChartBar, drawChartLine } from '../base-renderer';
import { CellType, ChartType } from './interface';
import type { IInternalCellRenderer, ICellRenderProps, IChartCell } from './interface';

export const chartCellRenderer: IInternalCellRenderer<IChartCell> = {
  type: CellType.Chart,
  needsHover: true,
  needsHoverPosition: true,
  draw: (cell: IChartCell, props: ICellRenderProps) => {
    const { ctx, rect, theme, hoverCellPosition } = props;
    const {
      rowHeaderTextColor: lineColor,
      cellHorizontalPadding,
      cellVerticalPadding,
      fontFamily,
    } = theme;
    const { x, y, width, height } = rect;
    const { data, displayData, chartType = ChartType.Line, color = lineColor } = cell;

    if (!data?.length || !displayData?.length) return;

    const [hoverX] = hoverCellPosition ?? [];
    const hoverAmount = hoverCellPosition ? 1 : 0;

    if (chartType === ChartType.Bar) {
      drawChartBar(ctx, {
        x: x + cellHorizontalPadding,
        y: y + cellVerticalPadding,
        width: width - cellHorizontalPadding * 2,
        height: height - cellVerticalPadding * 2,
        values: data,
        color,
        axisColor: lineColor,
        font: `8px ${fontFamily}`,
        hoverX: hoverX ? hoverX - cellHorizontalPadding : undefined,
        displayValues: displayData,
      });
    }

    if (chartType === ChartType.Line) {
      drawChartLine(ctx, {
        x: x + cellHorizontalPadding,
        y: y + cellVerticalPadding,
        width: width - cellHorizontalPadding * 2,
        height: height - cellVerticalPadding * 2,
        values: data,
        color,
        axisColor: lineColor,
        font: `8px ${fontFamily}`,
        hoverX: hoverX ? hoverX - cellHorizontalPadding : undefined,
        hoverAmount,
        displayValues: displayData,
      });
    }
  },
};
