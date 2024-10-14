import { PluginPosition } from '@teable/openapi';

export const excelFormConfig = {
  id: 'plgexcelform',
  name: 'Excel Form Designer',
  description: 'Design forms with Excel, then collect data into your table by excel',
  detailDesc: `
  Create powerful and flexible forms using the familiar Excel interface.

  With the Excel Form Designer plugin, you can:
  - Design form templates in Excel
  - Share your forms easily
  - Collect data directly into your multi-dimensional table

  Perfect for surveys, data collection, and customized form needs.

  [Learn more](https://teable.io)
  `,
  helpUrl: 'https://teable.io',
  positions: [PluginPosition.View],
  i18n: {
    zh: {
      name: 'Excel 表单设计器',
      helpUrl: 'https://teable.io',
      description: '使用 Excel 设计表单，并将数据收集到您的多维表格中',
      detailDesc: `
      使用熟悉的 Excel 界面创建强大而灵活的表单。

      使用 Excel 表单设计器插件，您可以：
      - 在 Excel 中设计表单模板
      - 轻松分享您的表单
      - 将数据直接收集到您的多维表格中

      非常适合问卷调查、数据收集和自定义表单需求。

      [了解更多](https://teable.io)
      `,
    },
  },
  logoPath: 'static/plugin/excel-form-logo.png',
  avatarPath: 'static/plugin/excel-form.png',
};
