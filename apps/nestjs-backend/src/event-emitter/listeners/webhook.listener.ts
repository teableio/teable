import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhookFactory } from '../../features/webhook/webhook.factory';
import { CoreEvent } from '../events';

// type IViewEvent = ViewUpdateEvent;
// type IRecordEvent = RecordCreateEvent | RecordDeleteEvent | RecordUpdateEvent;
// type IListenerEvent = IViewEvent | IRecordEvent;

@Injectable()
export class WebhookListener {
  constructor(private readonly webhookFactory: WebhookFactory) {}

  @OnEvent('base.*', { async: true })
  @OnEvent('table.*', { async: true })
  async listener(event: CoreEvent): Promise<void> {
    // event.context
    this.webhookFactory.run('', event);
  }
}
