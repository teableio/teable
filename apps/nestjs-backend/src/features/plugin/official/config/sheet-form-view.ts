import { PluginPosition } from '@teable/openapi';

export const sheetFormConfig = {
  id: 'plgsheetform',
  name: 'Sheet Form',
  description: 'Design forms with spread sheet, then collect data into your table by sheet form',
  detailDesc: `
  Create powerful and flexible forms using the familiar spread sheet interface.

  With the sheet Form Designer plugin, you can:
  - Design form templates in spread sheet
  - Share your forms easily
  - Collect data directly into your multi-dimensional table

  Perfect for surveys, data collection, and customized form needs.

  [Learn more](https://teable.io)
  `,
  helpUrl: 'https://teable.io',
  positions: [PluginPosition.View],
  i18n: {
    zh: {
      name: 'Sheet 表单',
      helpUrl: 'https://teable.io',
      description: '使用表格设计表单，并将数据收集到您的多维表格中',
      detailDesc: `
      使用熟悉的表格界面创建强大而灵活的表单。

      使用表格表单插件，您可以：
      - 在表格中设计表单模板
      - 轻松分享您的表格表单
      - 将数据直接收集到您的多维表格中

      非常适合问卷调查、数据收集和自定义表单需求。

      [了解更多](https://teable.io)
      `,
    },
  },
  logoPath: 'static/plugin/sheet-form-logo.png',
  avatarPath: 'static/plugin/sheet-form-logo.png',
};
