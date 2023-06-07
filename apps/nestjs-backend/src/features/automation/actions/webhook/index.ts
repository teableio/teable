import { Injectable, Logger, Scope } from '@nestjs/common';
import type { Almanac, Event, RuleResult } from 'json-rules-engine';
import _ from 'lodash';
import fetch from 'node-fetch';
import type { IActionResponse, ITemplateSchema, IConstSchema, IObjectSchema } from '../action-core';
import { ActionCore, actionConst, ActionResponseStatus } from '../action-core';

export interface IWebhookSchema extends Record<string, unknown> {
  url: ITemplateSchema;
  method: IConstSchema;
  headers?: IObjectSchema;
  body?: ITemplateSchema;
  timeout?: IConstSchema;
  responseParams?: IObjectSchema;
}

export interface IWebhookOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  responseParams?: Record<string, string>;
}

@Injectable({ scope: Scope.REQUEST })
export class Webhook extends ActionCore {
  private logger = new Logger(Webhook.name);

  constructor() {
    super();
  }

  bindParams(id: string, params: IWebhookSchema, priority?: number): this {
    return this.setName(id).setEvent({ type: id, params: params }).setPriority(priority);
  }

  onSuccess = async (event: Event, almanac: Almanac, _ruleResult: RuleResult): Promise<void> => {
    const {
      url,
      method,
      headers,
      body,
      timeout = 60000,
      responseParams,
    } = await this.parseInputSchema<IWebhookOptions>(event.params as IWebhookSchema, almanac);

    let outPut: IActionResponse<unknown>;

    await fetch(url, {
      method,
      headers,
      body,
      timeout,
    })
      .then((response) => response.json())
      .then((resultJson) => {
        const responseData = this.responseDataWrapper(resultJson, responseParams);
        outPut = { data: responseData, status: ActionResponseStatus.OK };
      })
      .catch((error) => {
        this.logger.error(error.message, error?.stack);
        outPut = {
          error: error.message,
          data: '',
          status: ActionResponseStatus.InternalServerError,
        };
      })
      .finally(() => {
        almanac.addRuntimeFact(`${actionConst.OutPutFlag}${this.name}`, outPut);
      });
  };

  private responseDataWrapper(
    json: Record<string, unknown>,
    responseParams?: Record<string, string>
  ) {
    let responseData: Record<string, unknown>;
    if (responseParams && !_.isEmpty(responseParams)) {
      // When the 'responseParams' parameter is defined, it means that custom response results are constructed.
      // The format and number of custom parameters depend on the user-defined parameter data.
      responseData = Object.entries(responseParams).reduce((pre, [key, value]) => {
        pre[key] = _.get(json, value);
        return pre;
      }, {} as Record<string, unknown>);
    } else {
      responseData = json;
    }
    return responseData;
  }
}
