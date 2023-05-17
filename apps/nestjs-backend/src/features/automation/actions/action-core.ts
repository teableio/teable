import type {
  Event,
  Almanac,
  RuleResult,
  TopLevelCondition,
  RuleProperties,
} from 'json-rules-engine';
import type {
  IWebhookSchema,
  IMailSenderSchema,
  ICreateRecordSchema,
} from 'src/features/automation/actions';

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

export type IActionRequest = IWebhookSchema | IMailSenderSchema | ICreateRecordSchema;
export type ITypeValueSchema = { type: string; value: string };

export type ITypePropertiesSchema = {
  type: string;
  properties: { key: ITypeValueSchema; value: ITemplateSchema }[];
};

export type IObjectPathValueSchema = {
  type: string;
  object: { nodeId: string; nodeType: string };
  path: { type: string; elements: ITypeValueSchema[] };
};

export type ITemplateSchema = {
  type: string;
  elements: (ITypeValueSchema | IObjectPathValueSchema)[];
};

export type IElementArraySchema = {
  type: string;
  elements: ITemplateSchema[];
};

export const actionConst = {
  OutPutFlag: '_output',
};

export abstract class ActionCore implements RuleProperties {
  name?: string;
  conditions: TopLevelCondition;
  event: Event;
  priority?: number;

  protected constructor() {
    this.conditions = {
      any: [
        {
          fact: '__fact_always__',
          operator: 'always',
          value: undefined,
        },
      ],
    };

    this.event = { type: '__unknown__' };
  }

  abstract bindParams(id: string, params: IActionRequest, priority?: number): this;

  setName(name: string) {
    if (!name) {
      throw new Error('Rule "name" must be defined');
    }
    this.name = name;
    return this;
  }

  setEvent(event: Event) {
    if (!event) throw new Error('Rule: setEvent() requires event object');
    if (!Object.prototype.hasOwnProperty.call(event, 'type'))
      throw new Error('Rule: setEvent() requires event object with "type" property');
    this.event = event;
    return this;
  }

  setPriority(priority: number) {
    if (priority <= 0) throw new Error('Priority must be greater than zero');
    this.priority = priority;
    return this;
  }

  onSuccess = (_event: Event, _almanac: Almanac, _ruleResult: RuleResult): void => {
    // Needs to be implemented by the successor itself
  };
}
