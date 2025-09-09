import type { IBaseQuery, PluginPosition } from '@teable/openapi';
import { z } from 'zod';

export const chartBaseAxisSchema = z.object({
  column: z.string(),
});

export const chartBaseAxisDisplayLineSchema = z.object({
  type: z.union([z.literal('line'), z.literal('area')]),
  position: z.union([z.literal('auto'), z.literal('left'), z.literal('right')]),
  lineStyle: z.union([z.literal('normal'), z.literal('linear'), z.literal('step')]),
});

export type IChartBaseAxisDisplayLine = z.infer<typeof chartBaseAxisDisplayLineSchema>;

export const chartBaseAxisDisplaySchema = z.union([
  z.object({
    type: z.literal('bar'),
    position: z.union([z.literal('auto'), z.literal('left'), z.literal('right')]),
  }),
  chartBaseAxisDisplayLineSchema,
]);

export type IChartBaseAxisDisplay = z.infer<typeof chartBaseAxisDisplaySchema>;

export const chartXAxisDisplaySchema = z.object({
  label: z.string().optional(),
});

export type IChartXAxisDisplay = z.infer<typeof chartXAxisDisplaySchema>;

export const chartYAxisDisplaySchema = z.object({
  label: z.string().optional(),
  range: z
    .object({
      max: z.number().optional(),
      min: z.number().optional(),
    })
    .optional(),
});

export type IChartYAxisDisplay = z.infer<typeof chartYAxisDisplaySchema>;

export const goalLineSchema = z.object({
  enabled: z.boolean().optional(),
  value: z.number().optional(),
  label: z.string().optional(),
});

export const chartPaddingSchema = z.object({
  top: z.number().optional(),
  right: z.number().optional(),
  bottom: z.number().optional(),
  left: z.number().optional(),
});

export type IChartPadding = z.infer<typeof chartPaddingSchema>;

export type IGoalLine = z.infer<typeof goalLineSchema>;

export const comboConfigSchema = z.object({
  xAxis: z
    .array(
      chartBaseAxisSchema.extend({
        display: chartBaseAxisDisplaySchema,
      })
    )
    .optional(),
  xAxisDisplay: chartXAxisDisplaySchema.optional(),
  yAxis: z
    .array(
      chartBaseAxisSchema
        .extend({
          label: z.string().optional(),
          prefix: z.string().optional(),
          suffix: z.string().optional(),
          decimal: z.number().max(10).min(0).optional(),
        })
        .extend({ display: chartBaseAxisDisplaySchema })
    )
    .optional(),
  yAxisDisplay: chartYAxisDisplaySchema.optional(),
  goalLine: goalLineSchema.optional(),
  showLabel: z.boolean().optional(),
  padding: chartPaddingSchema.optional(),
});

export type IComboConfig = z.infer<typeof comboConfigSchema>;

export const comboTypeSchema = z.union([z.literal('bar'), z.literal('line'), z.literal('area')]);

export type IComboType = z.infer<typeof comboTypeSchema>;

export const barConfigSchema = comboConfigSchema.extend({
  type: z.literal('bar'),
  stack: z.boolean().optional(),
});

export type IBarConfig = z.infer<typeof barConfigSchema>;

export const lineConfigSchema = comboConfigSchema.extend({
  type: z.literal('line'),
});

export type ILineConfig = z.infer<typeof lineConfigSchema>;

export const areaConfigSchema = comboConfigSchema.extend({
  type: z.literal('area'),
  stack: z.boolean().optional(),
});

export type IAreaConfig = z.infer<typeof areaConfigSchema>;

export const pieConfigSchema = z.object({
  type: z.literal('pie'),
  dimension: z.string().optional(),
  measure: z
    .object({
      column: z.string(),
      decimal: z.number().max(10).min(0).optional(),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
    })
    .optional(),
  showLabel: z.boolean().optional(),
  showTotal: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  padding: chartPaddingSchema.optional(),
});

export type IPieConfig = z.infer<typeof pieConfigSchema>;

export const tableConfigColumn = z.object({
  column: z.string(),
  width: z.number().optional(),
  label: z.string().optional(),
  hidden: z.boolean().optional(),
});
export type ITableConfigColumn = z.infer<typeof tableConfigColumn>;
export const tableConfigSchema = z.object({
  type: z.literal('table'),
  columns: z.array(tableConfigColumn).optional(),
});

export type ITableConfig = z.infer<typeof tableConfigSchema>;

export const chartConfigSchema = z.union([
  barConfigSchema,
  lineConfigSchema,
  areaConfigSchema,
  pieConfigSchema,
  tableConfigSchema,
]);

export type IChartConfig = z.infer<typeof chartConfigSchema>;

export interface IChartStorage {
  config?: IChartConfig;
  query: IBaseQuery;
}

export interface IPageParams {
  baseId: string;
  pluginInstallId: string;
  positionId: string;
  positionType: PluginPosition;
  pluginId: string;
  tableId?: string;
}
