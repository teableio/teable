import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IActionTriggerBuffer, IGridColumn } from '@teable/core';
import { getActionTriggerChannel, OpName } from '@teable/core';
import { isEmpty } from 'lodash';
import { match } from 'ts-pattern';
import { ShareDbService } from '../../share-db/share-db.service';
import type {
  RecordCreateEvent,
  RecordDeleteEvent,
  RecordUpdateEvent,
  ViewUpdateEvent,
  FieldUpdateEvent,
} from '../events';
import { Events } from '../events';

type IViewEvent = ViewUpdateEvent;
type IRecordEvent = RecordCreateEvent | RecordDeleteEvent | RecordUpdateEvent;
type IListenerEvent = IViewEvent | IRecordEvent | FieldUpdateEvent;

@Injectable()
export class ActionTriggerListener {
  private readonly logger = new Logger(ActionTriggerListener.name);

  constructor(private readonly shareDbService: ShareDbService) {}

  @OnEvent(Events.TABLE_VIEW_UPDATE, { async: true })
  @OnEvent(Events.TABLE_FIELD_UPDATE, { async: true })
  @OnEvent('table.record.*', { async: true })
  private async listener(listenerEvent: IListenerEvent): Promise<void> {
    // Handling table view update events
    if (this.isTableViewUpdateEvent(listenerEvent)) {
      await this.handleTableViewUpdate(listenerEvent as ViewUpdateEvent);
    }

    // Handling table field update events
    if (this.isTableFieldUpdateEvent(listenerEvent)) {
      await this.handleTableFieldUpdate(listenerEvent as FieldUpdateEvent);
    }

    // Handling table record events (create, delete, update)
    if (this.isTableRecordEvent(listenerEvent)) {
      await this.handleTableRecordEvent(listenerEvent as IRecordEvent);
    }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async handleTableViewUpdate(event: ViewUpdateEvent): Promise<void> {
    if (!this.isValidViewUpdateOperation(event)) {
      return;
    }

    const { tableId, view } = event.payload;
    const { id: viewId, filter, columnMeta, group } = view;

    const buffer: IActionTriggerBuffer = {
      applyViewFilter: filter ? [tableId, viewId] : undefined,
      applyViewGroup: group ? [tableId, viewId] : undefined,
      applyViewStatisticFunc: columnMeta ? [tableId, viewId] : undefined,
      showViewField: columnMeta ? [tableId, viewId] : undefined,
    };

    if (columnMeta != null) {
      Object.entries(columnMeta)?.forEach(([fieldId, { oldValue, newValue }]) => {
        const oldColumn = oldValue as IGridColumn;
        const newColumn = newValue as IGridColumn;

        const shouldShow = !newColumn?.hidden && oldColumn?.hidden !== newColumn?.hidden;
        const shouldApplyStatFunc = oldColumn?.statisticFunc !== newColumn?.statisticFunc;

        if (shouldShow) {
          buffer.showViewField!.push(fieldId);
        }
        if (shouldApplyStatFunc) {
          buffer.applyViewStatisticFunc!.push(fieldId);
        }
      });

      if (buffer.showViewField!.length <= 2) {
        delete buffer.showViewField;
      }
      if (buffer.applyViewStatisticFunc!.length <= 2) {
        delete buffer.applyViewStatisticFunc;
      }
    }

    if (!isEmpty(buffer)) {
      this.emitActionTrigger(tableId, buffer);
    }
  }

  private async handleTableFieldUpdate(event: FieldUpdateEvent): Promise<void> {
    if (!this.isValidFieldUpdateOperation(event)) {
      return;
    }

    const { tableId } = event.payload;
    return this.emitActionTrigger(tableId, {
      setField: [tableId],
    });
  }

  private async handleTableRecordEvent(event: IRecordEvent): Promise<void> {
    const { tableId } = event.payload;

    const buffer = match(event)
      .returnType<IActionTriggerBuffer>()
      .with({ name: Events.TABLE_RECORD_CREATE }, () => ({ addRecord: [tableId] }))
      .with({ name: Events.TABLE_RECORD_UPDATE }, () => ({ setRecord: [tableId] }))
      .with({ name: Events.TABLE_RECORD_DELETE }, () => ({ deleteRecord: [tableId] }))
      .otherwise(() => ({}));

    if (!isEmpty(buffer)) {
      this.emitActionTrigger(tableId, buffer);
    }
  }

  private isTableViewUpdateEvent(event: IListenerEvent): boolean {
    return Events.TABLE_VIEW_UPDATE === event.name;
  }

  private isTableFieldUpdateEvent(event: IListenerEvent): boolean {
    return Events.TABLE_FIELD_UPDATE === event.name;
  }

  private isValidViewUpdateOperation(event: ViewUpdateEvent): boolean | undefined {
    const propertyKeys = ['filter', 'group'];
    const { name, propertyKey } = event.context.opMeta || {};
    return name === OpName.UpdateViewColumnMeta || propertyKeys.includes(propertyKey as string);
  }

  private isValidFieldUpdateOperation(event: FieldUpdateEvent): boolean | undefined {
    const propertyKeys = ['options'];
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
