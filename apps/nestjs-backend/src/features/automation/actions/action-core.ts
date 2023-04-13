import type {
  Event,
  Almanac,
  RuleResult,
  TopLevelCondition,
  RuleProperties,
} from 'json-rules-engine';

export enum ActionResponseStatus {
  Unknown = -1,
  Success = 200,
  ServerError = 500,
}

export type IActionResponse<T> = {
  msg: string;
  data: T;
  code: ActionResponseStatus;
};

export const actionConst = {
  OutPutFlag: '_output',
};

export abstract class ActionCore implements RuleProperties {
  name: string;
  conditions: TopLevelCondition;
  event: Event;
  priority?: number;

  protected constructor(id: string, params?: Record<string, unknown>) {
    this.name = id;

    this.conditions = {
      any: [
        {
          fact: '__fact_always__',
          operator: 'always',
          value: undefined,
        },
      ],
    };

    this.event = {
      type: id,
      params: params,
    };
  }

  public setPriority(priority: number) {
    if (priority <= 0) throw new Error('Priority must be greater than zero');
    this.priority = priority;
    return this;
  }

  public onSuccess = (_event: Event, _almanac: Almanac, _ruleResult: RuleResult): void => {
    // Needs to be implemented by the successor itself
  };
}
