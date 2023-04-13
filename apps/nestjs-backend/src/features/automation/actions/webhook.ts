import type { Almanac, Event, RuleResult } from 'json-rules-engine';
import _ from 'lodash';
import type { RequestInit } from 'node-fetch';
import fetch from 'node-fetch';
import { replaceVars } from 'src/utils';
import type { IActionResponse } from './action-core';
import { ActionCore, actionConst, ActionResponseStatus } from './action-core';

export interface IWebhookRequest extends Record<string, unknown> {
  url: string[];
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: { [key: string]: string | string[] }[];
  body?: string[];
  timeout?: number;
  responseParams?: Record<string, string>[];
}

export class Webhook extends ActionCore {
  constructor(id: string, webhookRequest: IWebhookRequest, priority?: number) {
    super(id, webhookRequest);

    this.setPriority(priority ? priority : 1);
  }

  public onSuccess = async (
    event: Event,
    almanac: Almanac,
    _ruleResult: RuleResult
  ): Promise<void> => {
    const {
      url,
      method,
      headers,
      body,
      timeout = 60000,
      responseParams,
    } = event.params as IWebhookRequest;
    const requestInit: RequestInit = { method, timeout };

    const realUrl = await replaceVars(url, almanac);

    const realBody = await replaceVars(body, almanac);
    if (realBody) {
      requestInit.body = realBody;
    }

    const transformedHeaders = headers?.map(async (cur) => {
      return {
        [cur.key.toString()]: await replaceVars(cur.value, almanac),
      };
    });
    if (transformedHeaders) {
      const headerObjectsArray = await Promise.all(transformedHeaders);
      requestInit.headers = Object.assign({}, ...headerObjectsArray);
    }

    let outPut: IActionResponse<unknown>;
    try {
      const response = await fetch(realUrl!, requestInit);
      const resultJson = await response.json();

      let responseData;
      if (responseParams && !_.isEmpty(responseParams)) {
        // When the 'responseParams' parameter is defined, it means that custom response results are constructed.
        // The format and number of custom parameters depend on the user-defined parameter data.
        responseData = responseParams.reduce((pre, cur) => {
          pre[cur.name] = _.get(resultJson, cur.path);
          return pre;
        }, {});
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
