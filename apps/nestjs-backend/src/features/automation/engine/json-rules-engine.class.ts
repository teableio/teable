import { Injectable, Logger, Scope } from '@nestjs/common';
import dayjs from 'dayjs';
import type { EngineResult } from 'json-rules-engine';
import { Engine } from 'json-rules-engine';
import { UnreachableCaseError } from '../../../errors/unreachable-case-error';
import { Webhook, MailSender, CreateRecord } from '../actions';
import type { ActionCore, IActionRequest } from '../actions/action-core';
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
    this.engine.addFact<{ [key: string]: unknown }>('__system__', () => {
      return {
        execution_time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      };
    });
  }

  private getAction(actionType: string): ActionCore {
    switch (actionType) {
      case ActionTypeEnums.Webhook:
        return this.webhook;
      case ActionTypeEnums.MailSender:
        return this.mailSender;
      case ActionTypeEnums.CreateRecord:
        return this.createRecord;
      default:
        throw new UnreachableCaseError(actionType as never);
    }
  }

  addRule(
    actionType: string,
    options: { id: string; params: IActionRequest; priority?: number }
  ): void {
    const { id, params, priority } = options;
    const actionRule = this.getAction(actionType).bindParams(id, params, priority);
    this.engine.addRule(actionRule);
  }

  async fire(facts?: Record<string, unknown>): Promise<EngineResult> {
    return this.engine.run(facts);
  }
}
