export const chartConfig = {
  id: 'plgchart',
  name: 'Chart',
  description: 'Visualize your records on a bar, line, pie',
  detailDesc: `
  If you're looking for a colorful way to get a big-picture overview of a table, try a chart app.
  
  
  
  The chart app summarizes a table of records and turns it into an interactive bar, line, pie. Make your chart pop by choosing from a set of colors, or color-code the chart to match your records' associated single select fields.
  
  
  
  When you need to drill down into your records, clicking on any bar or point on your chart will bring up the associated record or records.
  
  
  Learn more](https://teable.io)

  `,
  helpUrl: 'https://teable.io',
  positions: ['dashboard'],
  i18n: {
    zh: {
      name: '图表',
      helpUrl: 'https://teable.cn',
      description: '通过柱状图、折线图、饼图可视化您的记录',
      detailDesc:
        '如果您想通过色彩丰富的方式从大局上了解表格，试试图表应用。\n\n图表应用汇总表格记录，并将其转换为交互式的柱状图、折线图、饼图。通过选择一组颜色让您的图表更引人注目，或根据记录的单选字段为图表添加颜色编码。\n\n当您需要深入了解记录时，点击图表上的任何柱状或点状部分，即可显示相关记录或记录详情。\n\n[了解更多](https://teable.cn)',
    },
  },
  logoPath: 'static/plugin/chart.png',
  pluginUserId: 'pluchartuser',
  avatarPath: 'static/plugin/chart.png',
};
