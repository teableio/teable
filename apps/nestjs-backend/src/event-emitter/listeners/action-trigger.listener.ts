import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IActionTriggerBuffer } from '@teable-group/core';
import { getActionTriggerChannel } from '@teable-group/core';
import { ShareDbService } from '../../share-db/share-db.service';
import type { RecordDeleteEvent, ViewUpdateEvent } from '../model';
import { Events, RecordCreateEvent, RecordUpdateEvent } from '../model';

type IListenerEvent = ViewUpdateEvent | RecordCreateEvent | RecordDeleteEvent | RecordUpdateEvent;

@Injectable()
export class ActionTriggerListener {
  private readonly logger = new Logger(ActionTriggerListener.name);

  constructor(private readonly shareDbService: ShareDbService) {}

  @OnEvent('table.view.update', { async: true })
  @OnEvent('table.record.*', { async: true })
  private async listener(listenerEvent: IListenerEvent): Promise<void> {
    if (Events.TABLE_VIEW_UPDATE === listenerEvent.name) {
      const viewUpdateEvent = listenerEvent as ViewUpdateEvent;
      if (
        viewUpdateEvent.context.opName &&
        !['setViewFilter', 'setViewColumnMeta'].includes(viewUpdateEvent.context.opName)
      ) {
        return;
      }
      const { tableId, view } = viewUpdateEvent;

      const normalizedViews = Array.isArray(view) ? view : [view];
      const viewIds = normalizedViews.map((v) => v?.id).filter(Boolean) as string[];

      this.emitTablePullAction(tableId, {
        fetchRowCount: viewIds,
        fetchAggregation: viewIds,
      });
    }

    if (
      [Events.TABLE_RECORD_CREATE, Events.TABLE_RECORD_DELETE, Events.TABLE_RECORD_UPDATE].includes(
        listenerEvent.name
      )
    ) {
      const recordEvent = listenerEvent as
        | RecordCreateEvent
        | RecordDeleteEvent
        | RecordUpdateEvent;
      const { tableId } = recordEvent;

      if (recordEvent instanceof RecordCreateEvent) {
        this.emitTablePullAction(tableId, {
          fetchRowCount: [tableId],
          fetchAggregation: [tableId],
        });
      } else if (recordEvent instanceof RecordUpdateEvent) {
        this.emitTablePullAction(tableId, {
          fetchAggregation: [tableId],
        });
      } else {
        this.emitTablePullAction(tableId, {
          fetchRowCount: [tableId],
          fetchAggregation: [tableId],
        });
      }
    }
  }

  private emitTablePullAction(tableId: string, data: IActionTriggerBuffer) {
    const channel = getActionTriggerChannel(tableId);

    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(tableId);
    localPresence.submit({ ...data, t: new Date().getTime() }, (error) => {
      error && this.logger.error(error);
    });
  }
}
