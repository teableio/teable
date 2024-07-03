/* eslint-disable @typescript-eslint/naming-convention */
import crypto from 'crypto';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import type { IWebhookVo } from '@teable/openapi';
import { ContentType } from '@teable/openapi';
import { filter, from, mergeMap } from 'rxjs';
import { match } from 'ts-pattern';
import type { CoreEvent } from '../../event-emitter/events';
import { WebhookService } from './webhook.service';

type IWebhook = IWebhookVo & { secret: string | null };

@Injectable()
export class WebhookFactory {
  private logger = new Logger(WebhookFactory.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly webHookService: WebhookService
  ) {}

  async run(spaceId: string, event: CoreEvent) {
    const webHookList = await this.webHookService.getWebhookListBySpaceId(spaceId);

    // 10s
    // event.payload

    from(webHookList).pipe(
      filter((webhookContext) => {
        return true;
      }),
      mergeMap((value) => {
        return this.sendHttpRequest(value, event);
      }, 10)
    );
  }

  private sendHttpRequest(webhookContext: IWebhook, event: CoreEvent) {
    const body = match(webhookContext.contentType)
      .with(ContentType.Json, () => {
        return JSON.stringify(event.payload);
      })
      .with(ContentType.FormUrlencoded, () => {
        return '';
      })
      .exhaustive();

    const headers: { [key: string]: string } = {};
    headers['User-Agent'] = 'teable/1.0.0';
    headers['Content-Type'] = webhookContext.contentType;
    headers['X-Event'] = event.name;
    headers['X-Hook-ID'] = '';

    if (webhookContext.secret) {
      headers['X-Signature-256'] = this.signature(webhookContext.secret, body);
    }

    return this.httpService
      .post(webhookContext.url, body, {
        headers: headers,
      })
      .pipe();
  }

  private signature(secret: string, body: unknown): string {
    const signature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');
    return `sha256=${signature}`;
  }
}
