import type { IWebhookRequest } from '../actions/webhook';
import { Webhook } from '../actions/webhook';
import engine from '../engine/json-rules-engine';

jest.setTimeout(100000000);
describe('Webhook Action Test', () => {
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
              '      "数字B": 3\n',
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
            ],
          },
          testResult: null,
          nextActionId: 'webhook_abc_2',
        },
        webhook_abc_2: {
          actionId: 'webhook_abc_2',
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
              '      "数字A": $.webhook_abc_1_output.data.computeResult1,\n',
              // '      "数字A": $.webhook_abc_1_output.data.data.records[0].fields.结果1,\n',
              '      "数字B": 1\n',
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
              {
                key: 'demo',
                value: [
                  '"$.webhook_abc_1_output.data.computeResult1"',
                  '$.webhook_abc_1_output.data.computeResult1',
                ],
              },
            ],
            responseParams: [],
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
      1
    );
    jsonNg.addRule(webhookAction);

    await jsonNg.run();
  });

  it('Context-dependent Actions', async () => {
    const length = Object.entries(mockData.workflow.actionsById).length;
    Object.entries(mockData.workflow.actionsById).forEach(([key, value], index) => {
      let action: any = undefined;
      if ('WEBHOOK' === value.actionType) {
        action = new Webhook(key, value.inputExpressions as IWebhookRequest, length - index);
      }

      jsonNg.addRule(action!);
    });

    const { events } = await jsonNg.run();

    // events.forEach((event) => console.log(event.params?.data));
  });
});
