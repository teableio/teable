import { ConsoleLogger } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { NextModule } from '../../next/next.module';
import type { ICreateRecordSchema } from '../actions';
import { CreateRecord } from '../actions';
import { AutomationModule } from '../automation.module';
import { JsonRulesEngine } from '../engine/json-rules-engine';
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
      inputSchema: {
        tableId: {
          type: 'const',
          value: 'tblyPjTHHtKmGOw25if',
        },
        fields: {
          type: 'object',
          properties: [
            {
              key: {
                type: 'const',
                value: 'fld5ZzA4lDzXTYwfLtE',
              },
              value: {
                type: 'template',
                elements: [
                  {
                    type: 'const',
                    value: 'name: ' + new Date(),
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
