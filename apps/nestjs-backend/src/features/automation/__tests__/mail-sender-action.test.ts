import type { IMailSenderRequest } from 'src/features/automation/actions/mail-sender';
import { MailSender } from 'src/features/automation/actions/mail-sender';
import type { IWebhookRequest } from 'src/features/automation/actions/webhook';
import { Webhook } from 'src/features/automation/actions/webhook';
import engine from '../engine/json-rules-engine';

jest.setTimeout(100000000);
describe('Mail-Sender Action Test', () => {
  const jsonNg = engine();

  const mockData = {
    workflow: {
      actionsById: {
        webhook_abc_1: {
          actionId: 'webhook_abc_1',
          actionType: 'WEBHOOK',
          description: null,
          inputExpressions: {
            url: [
              'https://api.vika.cn/fusion/v1/datasheets/dst1ASK1p8CHBPKYdu/records?viewId=viwVJPHoGioW7&fieldKey=name',
            ],
            body: [
              '{\n',
              '  "records": [\n',
              '  {\n',
              '    "fields": {\n',
              '      "数字A": 2,\n',
              '      "数字B": 3,\n',
              '      "邮箱": "penganpingprivte@gmail.com"\n',
              '    }\n',
              '  }\n',
              '],\n',
              '  "fieldKey": "name"\n',
              '}',
            ],
            method: 'POST',
            headers: [
              {
                key: 'Authorization',
                value: [' Bearer usk4vL5J4iGQW3qYV9SlVYH'],
              },
              {
                key: 'Content-Type',
                value: ['application/json'],
              },
            ],
            responseParams: [
              {
                name: 'computeResult1',
                path: 'data.records[0].fields.结果1',
              },
              {
                name: 'sendMail',
                path: 'data.records[0].fields.邮箱',
              },
            ],
          },
          testResult: null,
          nextActionId: 'webhook_abc_2',
        },
        mail_sender_abc_1: {
          actionId: 'mail_sender_abc_1',
          actionType: 'MAIL_SENDER',
          description: null,
          inputExpressions: {
            to: ['$.webhook_abc_1_output.data.sendMail'],
            subject: [
              '一封测试邮件主题',
              ' + ',
              '$.webhook_abc_1_output.data.computeResult1',
              ' + ',
              '"$.webhook_abc_1_output.data.computeResult1"',
            ],
            message: [
              '<h1>一封测试邮件消息<h1>',
              '<h3>',
              '一封测试邮件消息 : ',
              '$.__system__.execution_time',
              '<h3>',
              '<h1>$.webhook_abc_1_output.data.computeResult1<h1>',
            ],
          },
          testResult: null,
          nextActionId: null,
        },
      },
    },
  };

  it('a single unrelated Action', async () => {
    const webhookAction = new Webhook(
      mockData.workflow.actionsById.webhook_abc_1.actionId,
      mockData.workflow.actionsById.webhook_abc_1.inputExpressions as IWebhookRequest,
      2
    );
    jsonNg.addRule(webhookAction);

    const mailSenderAction = new MailSender(
      mockData.workflow.actionsById.mail_sender_abc_1.actionId,
      mockData.workflow.actionsById.mail_sender_abc_1.inputExpressions as IMailSenderRequest,
      1
    );
    jsonNg.addRule(mailSenderAction);

    await jsonNg.run();
  });
});
