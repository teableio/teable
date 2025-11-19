/**
 * Unified format for chart data
 */
export interface IChartData {
  /** X-axis data */
  xData: string[];
  /** Legend data */
  legendData: string[];
  /** Raw data */
  rawData: Record<string, unknown>[];
  /** Field ID to name mapping (only needed for Table data source, not for SQL data source) */
  fieldMap?: Record<string, string>;
}

export interface ISeriesConfig {
  name: string;
  data: unknown[];
  type?: 'line' | 'bar' | 'pie';
  universalTransition?: boolean;
  areaStyle?: {
    opacity: number;
  };
  label?: {
    show?: boolean;
    position?:
      | 'top'
      | 'bottom'
      | 'left'
      | 'right'
      | 'inside'
      | 'insideLeft'
      | 'insideRight'
      | 'insideTop'
      | 'insideBottom'
      | 'insideTopLeft'
      | 'insideTopRight'
      | 'insideBottomLeft'
      | 'insideBottomRight';
    distance?: number;
    align?: 'center' | 'left' | 'right';
    verticalAlign?: 'top' | 'bottom' | 'middle';
    formatter?: (value: string) => string;
  };
  radius?: string | string[];
  avoidLabelOverlap?: boolean;
  startAngle?: number;
  emphasis?: {
    itemStyle?: {
      shadowBlur?: number;
      shadowOffsetX?: number;
      shadowColor?: string;
    };
  };
}
