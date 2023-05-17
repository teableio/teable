import { Injectable, Scope } from '@nestjs/common';
import type { Almanac, Event, RuleResult } from 'json-rules-engine';
import _ from 'lodash';
import fetch from 'node-fetch';
import { JsonSchemaParser } from '../../engine/json-schema-parser.class';
import type {
  IActionResponse,
  ITemplateSchema,
  ITypeValueSchema,
  ITypePropertiesSchema,
} from '../action-core';
import { ActionCore, actionConst, ActionResponseStatus } from '../action-core';

export interface IWebhookSchema extends Record<string, unknown> {
  url: ITemplateSchema;
  method: ITypeValueSchema;
  headers?: ITypePropertiesSchema;
  body?: ITemplateSchema;
  timeout?: ITypeValueSchema;
  responseParams?: ITypePropertiesSchema;
}

@Injectable({ scope: Scope.REQUEST })
export class Webhook extends ActionCore {
  constructor() {
    super();
  }

  bindParams(id: string, params: IWebhookSchema, priority?: number): this {
    return this.setName(id)
      .setEvent({ type: id, params: params })
      .setPriority(priority ? priority : 1);
  }

  onSuccess = async (event: Event, almanac: Almanac, _ruleResult: RuleResult): Promise<void> => {
    const jsonSchemaParser = new JsonSchemaParser(event.params as IWebhookSchema, {
      pathResolver: async (_, path) => {
        const [id, p] = path;
        return await almanac.factValue(id, undefined, p);
      },
    });
    const {
      url,
      method,
      headers,
      body,
      timeout = 60000,
      responseParams,
    } = (await jsonSchemaParser.parse()) as {
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string;
      timeout: number;
      responseParams: Record<string, string>;
    };

    let outPut: IActionResponse<unknown>;
    try {
      const response = await fetch(url, { method, headers, body, timeout });
      const resultJson = await response.json();

      let responseData: Record<string, unknown>;
      if (responseParams && !_.isEmpty(responseParams)) {
        // When the 'responseParams' parameter is defined, it means that custom response results are constructed.
        // The format and number of custom parameters depend on the user-defined parameter data.
        responseData = Object.entries(responseParams).reduce((pre, [key, value]) => {
          pre[key] = _.get(resultJson, value);
          return pre;
        }, {} as Record<string, unknown>);
      } else {
        responseData = resultJson;
      }

      outPut = { msg: 'ok', data: responseData, code: ActionResponseStatus.Success };
    } catch (error) {
      outPut = {
        msg: (error as Error)?.message,
        data: undefined,
        code: ActionResponseStatus.ServerError,
      };
    }

    almanac.addRuntimeFact(`${this.name}${actionConst.OutPutFlag}`, outPut);
  };
}
