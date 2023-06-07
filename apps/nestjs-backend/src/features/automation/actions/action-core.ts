import type {
  Event,
  Almanac,
  RuleResult,
  TopLevelCondition,
  RuleProperties,
} from 'json-rules-engine';
import _ from 'lodash';
import type {
  IWebhookSchema,
  IMailSenderSchema,
  ICreateRecordSchema,
  IUpdateRecordSchema,
} from '../actions';
import { JsonSchemaParser } from '../engine/json-schema/parser';
import type { ActionTypeEnums } from '../enums/action-type.enum';

export type IActionType = Exclude<ActionTypeEnums, ActionTypeEnums.Decision>;

export enum ActionResponseStatus {
  OK = 200,
  BadRequest = 400,
  Unauthorized = 401,
  TooManyRequests = 429,

  InternalServerError = 500,
  ServiceUnavailable = 503,
  GatewayTimeout = 504,
}

export type IActionResponse<T> = {
  error?: string;
  data: T;
  status: ActionResponseStatus;
};

export type IActionInputSchema =
  | IWebhookSchema
  | IMailSenderSchema
  | ICreateRecordSchema
  | IUpdateRecordSchema;

export type INullSchema = { type: string };
export type IConstSchema = { type: string; value: number | string | boolean };

export type IObjectPathValueSchema = {
  type: string;
  object: { nodeId: string; nodeType: string };
  path: { type: string; elements: IConstSchema[] };
};

export type ITemplateSchema = {
  type: string;
  elements: (IConstSchema | IObjectPathValueSchema)[];
};

export type IObjectSchema = {
  type: string;
  properties: {
    key: IConstSchema;
    value:
      | INullSchema
      | IConstSchema
      | IObjectPathValueSchema
      | ITemplateSchema
      | IObjectSchema
      | IObjectArraySchema;
  }[];
};

export type IObjectArraySchema = {
  type: string;
  elements: (IConstSchema | IObjectPathValueSchema | ITemplateSchema | IObjectSchema)[];
};

export const actionConst = {
  OutPutFlag: 'action.',
};

export abstract class ActionCore implements RuleProperties {
  name?: string;
  conditions!: TopLevelCondition;
  event!: Event;
  priority?: number;

  protected constructor() {
    this.setConditions({
      any: [
        {
          fact: '__fact_always__',
          operator: 'always',
          value: undefined,
        },
      ],
    });

    this.setEvent({ type: '__unknown__' });
  }

  abstract bindParams(id: string, inputSchema: IActionInputSchema, priority?: number): this;

  protected async parseInputSchema<TResult>(
    schema: IActionInputSchema,
    almanac: Almanac
  ): Promise<TResult> {
    const jsonSchemaParser = new JsonSchemaParser<IActionInputSchema, TResult>(schema, {
      pathResolver: async (value, path) => {
        const [id, p] = path;
        const omitPath = `${_.startsWith(id, actionConst.OutPutFlag) ? 'data.' : ''}${p}`;
        return await almanac.factValue(id, undefined, omitPath);
      },
    });

    return await jsonSchemaParser.parse();
  }

  protected setName(name: string): this {
    if (!name) {
      throw new Error('Rule "name" must be defined');
    }
    this.name = name;
    return this;
  }

  protected setEvent(event: Event): this {
    if (!event) throw new Error('Rule: setEvent() requires event object');
    if (!Object.prototype.hasOwnProperty.call(event, 'type'))
      throw new Error('Rule: setEvent() requires event object with "type" property');
    this.event = event;
    return this;
  }

  protected setPriority(priority?: number): this {
    priority = priority ?? 1;
    if (priority <= 0) throw new Error('Priority must be greater than zero');
    this.priority = priority;
    return this;
  }

  setConditions(conditions: TopLevelCondition): this {
    if (
      !Object.prototype.hasOwnProperty.call(conditions, 'all') &&
      !Object.prototype.hasOwnProperty.call(conditions, 'any')
    ) {
      throw new Error('"conditions" root must contain a single instance of "all" or "any"');
    }
    this.conditions = conditions;
    return this;
  }

  onSuccess = (_event: Event, _almanac: Almanac, _ruleResult: RuleResult): void => {
    // Needs to be implemented by the successor itself
  };
}
