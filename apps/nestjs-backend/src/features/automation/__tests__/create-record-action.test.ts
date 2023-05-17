import { ConsoleLogger } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { NextModule } from '../../next/next.module';
import type { ICreateRecordSchema } from '../actions';
import { CreateRecord } from '../actions';
import { AutomationModule } from '../automation.module';
import { JsonRulesEngine } from '../engine/json-rules-engine.class';
import { ActionTypeEnums } from '../enums/action-type.enum';

jest.setTimeout(100000000);
describe('Create-Record Action Test', () => {
  let jsonRulesEngine: JsonRulesEngine;
  let createRecord: CreateRecord;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AutomationModule, NextModule.forRoot({ port: 3000 }), EventEmitterModule.forRoot()],
    }).compile();

    moduleRef.useLogger(new ConsoleLogger());

    jsonRulesEngine = await moduleRef.resolve<JsonRulesEngine>(JsonRulesEngine);
    createRecord = await moduleRef.resolve<CreateRecord>(CreateRecord);
  });

  it('should call onSuccess and create records', async () => {
    jsonRulesEngine.addRule(ActionTypeEnums.CreateRecord, {
      id: 'wac3lzmmwSKWmtYoOF6',
      params: {
        tableId: {
          type: 'text',
          value: 'tbluD1SibWWuWFza6YL',
        },
        fields: {
          type: 'object',
          properties: [
            {
              key: {
                type: 'text',
                value: 'fldkTOW9IsLtIHWKrDE',
              },
              value: {
                type: 'template',
                elements: [
                  {
                    type: 'text',
                    value: 'ABC',
                  },
                ],
              },
            },
            {
              key: {
                type: 'text',
                value: 'fld9KPv3xCowINhn3Oy',
              },
              value: {
                type: 'template',
                elements: [
                  {
                    type: 'text',
                    value: '123',
                  },
                ],
              },
            },
          ],
        },
      } as ICreateRecordSchema,
    });

    const { results } = await jsonRulesEngine.fire();

    expect(results).toBeDefined();

    const [result] = results;

    expect(result.result).toBeTruthy();
  });
});
