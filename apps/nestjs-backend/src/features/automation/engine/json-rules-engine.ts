import { Injectable, Logger, Scope } from '@nestjs/common';
import { assertNever } from '@teable/core';
import dayjs from 'dayjs';
import type { EngineResult, TopLevelCondition } from 'json-rules-engine';
import { Engine } from 'json-rules-engine';
import { Webhook, MailSender, CreateRecord, UpdateRecord } from '../actions';
import type { ActionCore, IActionInputSchema, IActionType } from '../actions/action-core';
import { ActionTypeEnums } from '../enums/action-type.enum';

@Injectable({ scope: Scope.REQUEST })
export class JsonRulesEngine {
  private logger = new Logger(JsonRulesEngine.name);
  private engine: Engine;

  constructor(
    private readonly webhook: Webhook,
    private readonly mailSender: MailSender,
    private readonly createRecord: CreateRecord,
    private readonly updateRecord: UpdateRecord
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
      case ActionTypeEnums.UpdateRecord:
        return this.updateRecord;
      default:
        assertNever(actionType);
    }
  }

  addRule(
    actionId: string,
    actionType: string,
    options: {
      inputSchema: IActionInputSchema;
      conditions?: TopLevelCondition;
      priority?: number;
    }
  ): void {
    const { inputSchema, conditions, priority } = options;

    const actionRule = this.getAction(actionType as IActionType).bindParams(
      actionId,
      inputSchema,
      priority
    );

    if (conditions) {
      actionRule.setConditions(conditions);
    }

    this.engine.addRule(actionRule);
  }

  async fire(facts?: Record<string, unknown>): Promise<EngineResult> {
    return await this.engine.run(facts);
  }
}
