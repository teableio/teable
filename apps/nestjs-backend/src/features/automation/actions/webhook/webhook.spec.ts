import { ConsoleLogger } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { NextModule } from '../../../next/next.module';
import { AutomationModule } from '../../automation.module';
import { JsonRulesEngine } from '../../engine/json-rules-engine';
import ajv from '../../engine/json-schema/ajv';
import { ActionTypeEnums } from '../../enums/action-type.enum';
import type { IWebhookSchema } from './webhook';

jest.setTimeout(100000000);
describe('Webhook Action Test', () => {
  let jsonRulesEngine: JsonRulesEngine;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AutomationModule, NextModule.forRoot({ port: 3000 }), EventEmitterModule.forRoot()],
    }).compile();

    moduleRef.useLogger(new ConsoleLogger());

    jsonRulesEngine = await moduleRef.resolve<JsonRulesEngine>(JsonRulesEngine);
  });

  const webhookData = {
    id: 'wac3lzmmwSKWmtYoOF6',
    priority: 2,
    inputSchema: {
      url: {
        type: 'template',
        elements: [
          {
            type: 'const',
            value: 'https://tenapi.cn/v2/douyinhot',
          },
        ],
      },
      method: {
        type: 'const',
        value: 'GET',
      },
      headers: {
        type: 'object',
        properties: [
          {
            key: {
              type: 'const',
              value: 'User-Agent',
            },
            value: {
              type: 'template',
              elements: [
                {
                  type: 'const',
                  value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                },
              ],
            },
          },
        ],
      },
      responseParams: {
        type: 'object',
        properties: [
          {
            key: {
              type: 'const',
              value: 'topData',
            },
            value: {
              type: 'template',
              elements: [
                {
                  type: 'const',
                  value: 'data[0].name',
                },
              ],
            },
          },
        ],
      },
    } as IWebhookSchema,
  };

  it('should call onSuccess and send request', async () => {
    expect(ajv.validate('WebhookSchema', webhookData.inputSchema)).toBeTruthy();

    jsonRulesEngine.addRule(webhookData.id, ActionTypeEnums.Webhook, webhookData);

    const { results, almanac } = await jsonRulesEngine.fire();
    expect(results).toBeDefined();

    const [result] = results;
    expect(result.result).toBeTruthy();

    const topData = await almanac.factValue(
      'action.wac3lzmmwSKWmtYoOF6',
      undefined,
      'data.topData'
    );
    expect(topData).toBeDefined();
  });
});
