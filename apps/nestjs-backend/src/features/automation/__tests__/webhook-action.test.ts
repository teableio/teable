import type { IWebhookRequest } from '../actions/webhook';
import { Webhook } from '../actions/webhook';
import engine from '../engine/json-rules-engine';

jest.setTimeout(100000000);
describe('Webhook Action Test', () => {
  const jsonNg = engine();

  const mockData = {
    id: 'wflRKLYPWS1Hrp0MD',
    name: 'Automation 1',
    description: null,
    deploymentStatus: 'deployed',
    trigger: {
      id: 'wtrdS3OIXzjyRyvnP',
      triggerType: 'ADD_RECORD',
      description: null,
      inputExpressions: {
        tableId: 'tblwEp45tdvwTxiUl',
      },
    },
    actions: {
      wacUjOrjDfSALAaZCL8: {
        id: 'wacUjOrjDfSALAaZCL8',
        actionType: 'WEBHOOK',
        description: null,
        inputExpressions: {
          url: ['https://127.0.0.1:3000/api/table/tabASK1p8CHBPKYdu/record'],
          body: [
            '{\n',
            '  "records": [\n',
            '  {\n',
            '    "fields": {\n',
            '      "name": "tom"\n',
            '    }\n',
            '  }\n',
            ']\n',
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
              path: 'data.records[0].fields.name',
            },
          ],
        },
        testResult: null,
        nextActionId: 'wacUjOrjDfSALAaZCL9',
      },
      wacUjOrjDfSALAaZCL9: {
        id: 'wacUjOrjDfSALAaZCL9',
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
  };

  it('a single unrelated Action', async () => {
    const webhookAction = new Webhook(
      mockData.actions.wacUjOrjDfSALAaZCL8.id,
      mockData.actions.wacUjOrjDfSALAaZCL8.inputExpressions as IWebhookRequest,
      1
    );
    jsonNg.addRule(webhookAction);

    await jsonNg.run();
  });

  it('Context-dependent Actions', async () => {
    const length = Object.entries(mockData.actions).length;
    Object.entries(mockData.actions).forEach(([key, value], index) => {
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
