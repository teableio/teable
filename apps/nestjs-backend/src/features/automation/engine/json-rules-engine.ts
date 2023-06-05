import { Injectable, Logger, Scope } from '@nestjs/common';
import { assertNever } from '@teable-group/core';
import dayjs from 'dayjs';
import type { EngineResult } from 'json-rules-engine';
import { Engine } from 'json-rules-engine';
import { Webhook, MailSender, CreateRecord } from '../actions';
import type { ActionCore, IActionInputSchema, IActionType } from '../actions/action-core';
import { ActionTypeEnums } from '../enums/action-type.enum';

@Injectable({ scope: Scope.REQUEST })
export class JsonRulesEngine {
  private logger = new Logger(JsonRulesEngine.name);
  private engine: Engine;

  constructor(
    private readonly webhook: Webhook,
    private readonly mailSender: MailSender,
    private readonly createRecord: CreateRecord
  ) {
    this.engine = new Engine([], { allowUndefinedFacts: true });
    this.initOperator();
    this.initFact();
  }

  private initOperator() {
    /*
     * `always` executed, conditions, operator variables
     */
    this.engine.addOperator('always', () => {
      return true;
    });
  }

  private initFact() {
    /*
     * initialize built in system variables
     */
    this.engine.addFact<{ [key: string]: unknown }>('__system__.runEnv', () => {
      return {
        executionTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      };
    });
  }

  private getAction(actionType: IActionType): ActionCore {
    switch (actionType) {
      case ActionTypeEnums.Webhook:
        return this.webhook;
      case ActionTypeEnums.MailSender:
        return this.mailSender;
      case ActionTypeEnums.CreateRecord:
        return this.createRecord;
      default:
        assertNever(actionType);
    }
  }

  addRule(
    actionType: string,
    options: {
      id: string;
      parentNodeId?: string;
      inputSchema: IActionInputSchema;
      priority?: number;
    }
  ): void {
    const { id, parentNodeId, inputSchema, priority } = options;

    const actionRule = this.getAction(actionType as IActionType).bindParams(
      id,
      inputSchema,
      priority
    );

    let conditions = actionRule.conditions;
    if (parentNodeId) {
      conditions = {
        all: [
          {
            fact: `action.${parentNodeId}`,
            operator: 'equal',
            value: 200,
            path: '$.code',
          },
        ],
      };
    }
    actionRule.setConditions(conditions);

    this.engine.addRule(actionRule);
  }

  async fire(facts?: Record<string, unknown>): Promise<EngineResult> {
    return await this.engine.run(facts);
  }
}
