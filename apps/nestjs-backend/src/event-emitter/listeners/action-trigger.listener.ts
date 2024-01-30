import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IActionTriggerBuffer, IColumn } from '@teable/core';
import { getActionTriggerChannel } from '@teable/core';
import { isEmpty } from 'lodash';
import { ShareDbService } from '../../share-db/share-db.service';
import type { RecordDeleteEvent, ViewUpdateEvent } from '../events';
import { Events, RecordCreateEvent, RecordUpdateEvent } from '../events';

type IViewEvent = ViewUpdateEvent;
type IRecordEvent = RecordCreateEvent | RecordDeleteEvent | RecordUpdateEvent;
type IListenerEvent = IViewEvent | IRecordEvent;

@Injectable()
export class ActionTriggerListener {
  private readonly logger = new Logger(ActionTriggerListener.name);

  constructor(private readonly shareDbService: ShareDbService) {}

  @OnEvent(Events.TABLE_VIEW_UPDATE, { async: true })
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
    if (!this.isValidViewUpdateOperation(event)) {
      return;
    }

    const { tableId, view } = event.payload;
    const { id: viewId, filter, columnMeta, group } = view;

    let buffer: IActionTriggerBuffer = {};
    if (filter) {
      buffer = {
        ...buffer,
        applyViewFilter: [tableId, viewId],
      };
    }

    if (group) {
      buffer = {
        ...buffer,
        applyViewGroup: [tableId, viewId],
      };
    }

    if (columnMeta) {
      const fieldIds = Object.entries(columnMeta)
        .filter(([_, v]) => !(v.newValue as IColumn).hidden)
        .map(([fieldId, _]) => fieldId);

      if (fieldIds.length) {
        buffer = {
          ...buffer,
          showViewField: [tableId, viewId, ...fieldIds],
        };
      }
    }

    !isEmpty(buffer) && this.emitActionTrigger(tableId, buffer);
  }

  private async handleTableRecordEvent(event: IRecordEvent): Promise<void> {
    const { tableId } = event.payload;
    const buffer: IActionTriggerBuffer = {};

    switch (event.constructor) {
      case RecordCreateEvent:
        buffer.tableAdd = [tableId];
        break;
      case RecordUpdateEvent:
        buffer.tableUpdate = [tableId];
        break;
      default:
        buffer.tableDelete = [tableId];
        break;
    }

    !isEmpty(buffer) && this.emitActionTrigger(tableId, buffer);
  }

  private isTableViewUpdateEvent(event: IListenerEvent): boolean {
    return Events.TABLE_VIEW_UPDATE === event.name;
  }

  private isValidViewUpdateOperation(event: ViewUpdateEvent): boolean | undefined {
    const propertyKeys = ['filter', 'sort', 'group', 'columnMeta'];
    const { propertyKey } = event.context.opMeta || {};
    return propertyKeys.includes(propertyKey as string);
  }

  private isTableRecordEvent(event: IListenerEvent): boolean {
    const recordEvents = [
      Events.TABLE_RECORD_CREATE,
      Events.TABLE_RECORD_DELETE,
      Events.TABLE_RECORD_UPDATE,
    ];
    return recordEvents.includes(event.name);
  }

  private emitActionTrigger(tableId: string, data: IActionTriggerBuffer) {
    const channel = getActionTriggerChannel(tableId);

    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(tableId);
    localPresence.submit({ ...data, t: new Date().getTime() }, (error) => {
      error && this.logger.error(error);
    });
  }
}
