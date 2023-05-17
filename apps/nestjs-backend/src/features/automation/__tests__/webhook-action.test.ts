import { ConsoleLogger } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { NextModule } from '../../next/next.module';
import type { IWebhookSchema } from '../actions';
import { Webhook } from '../actions';
import { AutomationModule } from '../automation.module';
import { JsonRulesEngine } from '../engine/json-rules-engine.class';
import { ActionTypeEnums } from '../enums/action-type.enum';

jest.setTimeout(100000000);
describe('Webhook Action Test', () => {
  let jsonRulesEngine: JsonRulesEngine;
  let webhook: Webhook;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AutomationModule, NextModule.forRoot({ port: 3000 }), EventEmitterModule.forRoot()],
    }).compile();

    moduleRef.useLogger(new ConsoleLogger());

    jsonRulesEngine = await moduleRef.resolve<JsonRulesEngine>(JsonRulesEngine);
    webhook = await moduleRef.resolve<Webhook>(Webhook);
  });

  it('should call onSuccess and create records', async () => {
    jsonRulesEngine.addRule(ActionTypeEnums.Webhook, {
      id: 'wac3lzmmwSKWmtYoOF6',
      params: {
        url: {
          type: 'template',
          elements: [
            {
              type: 'text',
              value: 'http://www.weather.com.cn/data/cityinfo/101010100.html',
            },
          ],
        },
        method: {
          type: 'text',
          value: 'GET',
        },
        headers: {
          type: 'object',
          properties: [
            {
              key: {
                type: 'text',
                value: 'User-Agent',
              },
              value: {
                type: 'template',
                elements: [
                  {
                    type: 'text',
                    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                  },
                ],
              },
            },
          ],
        },
        // body: {
        //   type: 'template',
        //   elements: [
        //     {
        //       type: 'text',
        //       value: '{',
        //     },
        //     {
        //       type: 'text',
        //       value: '"name":"abc"',
        //     },
        //     {
        //       type: 'text',
        //       value: '}',
        //     },
        //   ],
        // },
        responseParams: {
          type: 'object',
          properties: [
            {
              key: {
                type: 'text',
                value: 'city',
              },
              value: {
                type: 'template',
                elements: [
                  {
                    type: 'text',
                    value: 'weatherinfo.city',
                  },
                ],
              },
            },
          ],
        },
      } as IWebhookSchema,
    });

    const { results } = await jsonRulesEngine.fire();

    expect(results).toBeDefined();

    const [result] = results;

    expect(result.result).toBeTruthy();
  });
});
