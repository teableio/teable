import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IActionTriggerBuffer } from '@teable-group/core';
import { getActionTriggerChannel } from '@teable-group/core';
import { ShareDbService } from '../../share-db/share-db.service';
import type { FieldUpdateEvent, RecordDeleteEvent, ViewUpdateEvent } from '../model';
import { Events, RecordCreateEvent, RecordUpdateEvent } from '../model';

type IListenerEvent =
  | ViewUpdateEvent
  | FieldUpdateEvent
  | RecordCreateEvent
  | RecordDeleteEvent
  | RecordUpdateEvent;

@Injectable()
export class ActionTriggerListener {
  private readonly logger = new Logger(ActionTriggerListener.name);

  constructor(private readonly shareDbService: ShareDbService) {}

  @OnEvent('table.view.update', { async: true })
  @OnEvent('table.field.update', { async: true })
  @OnEvent('table.record.*', { async: true })
  private async listener(listenerEvent: IListenerEvent): Promise<void> {
    if (Events.TABLE_FIELD_UPDATE === listenerEvent.name) {
      const fieldEvent = listenerEvent as FieldUpdateEvent;
      if (fieldEvent.context.opName !== 'setColumnMeta') {
        return;
      }
      const { tableId } = fieldEvent;

      this.emitTablePullAction(tableId, {
        fetchAggregation: true,
      });
    }

    if (Events.TABLE_VIEW_UPDATE === listenerEvent.name) {
      const viewEvent = listenerEvent as ViewUpdateEvent;
      if (viewEvent.context.opName !== 'setViewFilter') {
        return;
      }
      const { tableId } = viewEvent;

      this.emitTablePullAction(tableId, {
        fetchRowCount: true,
        fetchAggregation: true,
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
      let fieldIds: string[] | undefined;
      const { tableId } = recordEvent;

      if (recordEvent instanceof RecordCreateEvent) {
        this.emitTablePullAction(tableId, {
          fetchRowCount: true,
          fetchAggregation: true,
        });
      } else if (recordEvent instanceof RecordUpdateEvent) {
        this.emitTablePullAction(tableId, {
          fetchAggregation: true,
        });
      } else {
        this.emitTablePullAction(tableId, {
          fetchRowCount: true,
          fetchAggregation: true,
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
