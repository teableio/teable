import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IActionTriggerBuffer } from '@teable-group/core';
import { getActionTriggerChannel } from '@teable-group/core';
import { ShareDbService } from '../../share-db/share-db.service';
import type { RecordCreateEvent, RecordDeleteEvent, ViewUpdateEvent } from '../model';
import { Events, RecordUpdateEvent } from '../model';

type IViewEvent = ViewUpdateEvent;
type IRecordEvent = RecordCreateEvent | RecordDeleteEvent | RecordUpdateEvent;
type IListenerEvent = IViewEvent | IRecordEvent;

@Injectable()
export class ActionTriggerListener {
  private readonly logger = new Logger(ActionTriggerListener.name);

  constructor(private readonly shareDbService: ShareDbService) {}

  @OnEvent('table.view.update', { async: true })
  @OnEvent('table.record.*', { async: true })
  private async listener(listenerEvent: IListenerEvent): Promise<void> {
    // Handling table view update events
    if (this.isTableViewUpdateEvent(listenerEvent)) {
      await this.handleTableViewUpdate(listenerEvent as ViewUpdateEvent);
    }

    // Handling table record events (create, delete, update)
    if (this.isTableRecordEvent(listenerEvent)) {
      await this.handleTableRecordEvent(listenerEvent as IRecordEvent);
    }
  }

  private async handleTableViewUpdate(event: ViewUpdateEvent): Promise<void> {
    const {
      tableId,
      view: { id: viewId },
    } = event;
    if (!this.isValidViewUpdateOperation(event)) {
      return;
    }

    this.emitTablePullAction(tableId, {
      fetchRowCount: [viewId],
      fetchAggregation: [viewId],
    });
  }

  private async handleTableRecordEvent(event: IRecordEvent): Promise<void> {
    const { tableId } = event;

    if (event instanceof RecordUpdateEvent) {
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

  private isTableViewUpdateEvent(event: IListenerEvent): boolean {
    return Events.TABLE_VIEW_UPDATE === event.name;
  }

  private isValidViewUpdateOperation(event: ViewUpdateEvent): boolean | undefined {
    const operationNames = ['setViewFilter', 'setViewColumnMeta'];
    return event.context.opName && operationNames.includes(event.context.opName);
  }

  private isTableRecordEvent(event: IListenerEvent): boolean {
    const recordEvents = [
      Events.TABLE_RECORD_CREATE,
      Events.TABLE_RECORD_DELETE,
      Events.TABLE_RECORD_UPDATE,
    ];
    return recordEvents.includes(event.name);
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
