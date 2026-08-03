import { PluginPosition } from '@teable/openapi';

export const sheetFormConfig = {
  id: 'plgsheetform',
  name: 'Sheet Form',
  description: 'Design forms with spread sheet, then collect data into your table by sheet form',
  detailDesc:
    'Create powerful and flexible forms using the familiar spread sheet interface. \n\nWith the sheet Form Designer plugin, you can: \n\n- Design form templates in spread sheet. \n\n- Share your forms easily. \n\n- Collect data directly into your multi-dimensional table. \n\nPerfect for surveys, data collection, and customized form needs. \n\n[Learn more](https://help.teable.ai/en/basic/plugin/sheet-form)',
  helpUrl: 'https://help.teable.ai/en/basic/plugin/sheet-form',
  positions: [PluginPosition.View],
  i18n: {
    zh: {
      name: 'Sheet 表单',
      helpUrl: 'https://help.teable.cn/zh/basic/plugin/sheet-form',
      description: '使用表格设计表单，并将数据收集到您的多维表格中',
      detailDesc:
        '使用熟悉的表格界面创建强大而灵活的表单。\n\n使用表格表单插件，您可以： \n\n - 在表格中设计表单模板。 \n\n - 轻松分享您的表格表单。 \n\n - 将数据直接收集到您的多维表格中。 \n\n非常适合问卷调查、数据收集和自定义表单需求。\n\n[了解更多](https://teable.cn)',
    },
  },
  logoPath: 'static/plugin/sheet-form-logo.png',
  avatarPath: 'static/plugin/sheet-form-logo.png',
};
