import { PluginPosition } from '@teable/openapi';
import type { IOfficialPluginConfig } from './types';

export const chartConfig: IOfficialPluginConfig = {
  id: 'plgchart',
  name: 'Chart',
  description: 'Visualize your records on a bar, line, pie',
  detailDesc: `
  If you're looking for a colorful way to get a big-picture overview of a table, try a chart app.
  
  
  
  The chart app summarizes a table of records and turns it into an interactive bar, line, pie. 
  

  [Learn more](https://teable.ai)

  `,
  helpUrl: 'https://help.teable.ai/en/basic/plugin/chart',
  positions: [PluginPosition.Dashboard, PluginPosition.Panel],
  i18n: {
    zh: {
      name: '图表',
      helpUrl: 'https://help.teable.cn/zh/basic/plugin/chart',
      description: '通过柱状图、折线图、饼图可视化您的记录',
      detailDesc:
        '如果您想通过色彩丰富的方式从大局上了解表格，试试图表应用。\n\n图表应用汇总表格记录，并将其转换为交互式的柱状图、折线图、饼图。\n\n[了解更多](https://teable.cn)',
    },
  },
  logoPath: 'static/plugin/chart.png',
};
