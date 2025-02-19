import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ITableActionKey, IGridColumn, IViewActionKey } from '@teable/core';
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
  FieldCreateEvent,
  FieldDeleteEvent,
} from '../events';
import { Events } from '../events';

type IViewEvent = ViewUpdateEvent;
type IRecordEvent = RecordCreateEvent | RecordDeleteEvent | RecordUpdateEvent;
type IListenerEvent =
  | IViewEvent
  | IRecordEvent
  | FieldUpdateEvent
  | FieldCreateEvent
  | FieldDeleteEvent;

export interface IActionTriggerData {
  actionKey: ITableActionKey | IViewActionKey;
  payload?: Record<string, unknown>;
}

@Injectable()
export class ActionTriggerListener {
  private readonly logger = new Logger(ActionTriggerListener.name);

  constructor(private readonly shareDbService: ShareDbService) {}

  @OnEvent(Events.TABLE_VIEW_UPDATE, { async: true })
  @OnEvent(Events.TABLE_FIELD_UPDATE, { async: true })
  @OnEvent(Events.TABLE_FIELD_CREATE, { async: true })
  @OnEvent(Events.TABLE_FIELD_DELETE, { async: true })
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

    // Handling table field create events
    if (this.isTableFieldCreateEvent(listenerEvent)) {
      await this.handleTableFieldCreate(listenerEvent as FieldCreateEvent);
    }

    // Handling table field delete events
    if (this.isTableFieldDeleteEvent(listenerEvent)) {
      await this.handleTableFieldDelete(listenerEvent as FieldDeleteEvent);
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

    const { view } = event.payload;
    const { id: viewId, filter, columnMeta, group } = view;

    const buffer: IViewActionKey[] = [];
    filter && buffer.push('applyViewFilter');
    group && buffer.push('applyViewGroup');

    if (columnMeta != null) {
      Object.entries(columnMeta)?.forEach(([_fieldId, { oldValue, newValue }]) => {
        const oldColumn = oldValue as IGridColumn;
        const newColumn = newValue as IGridColumn;

        const shouldShow = !newColumn?.hidden && oldColumn?.hidden !== newColumn?.hidden;
        const shouldApplyStatFunc = oldColumn?.statisticFunc !== newColumn?.statisticFunc;

        if (shouldShow) {
          buffer.push('showViewField');
        }
        if (shouldApplyStatFunc) {
          buffer.push('applyViewStatisticFunc');
        }
      });
    }

    if (!isEmpty(buffer)) {
      this.emitActionTrigger(
        viewId,
        buffer.map((actionKey) => ({ actionKey }))
      );
    }
  }

  private async handleTableFieldUpdate(event: FieldUpdateEvent): Promise<void> {
    if (!this.isValidFieldUpdateOperation(event)) {
      return;
    }

    const { tableId } = event.payload;
    return this.emitActionTrigger(tableId, [{ actionKey: 'setField', payload: event.payload }]);
  }

  private async handleTableFieldCreate(event: FieldCreateEvent): Promise<void> {
    const { tableId } = event.payload;
    return this.emitActionTrigger(tableId, [{ actionKey: 'addField', payload: event.payload }]);
  }

  private async handleTableFieldDelete(event: FieldDeleteEvent): Promise<void> {
    const { tableId } = event.payload;
    return this.emitActionTrigger(tableId, [{ actionKey: 'deleteField', payload: event.payload }]);
  }

  private async handleTableRecordEvent(event: IRecordEvent): Promise<void> {
    const { tableId } = event.payload;

    const buffer = match(event)
      .returnType<ITableActionKey[]>()
      .with({ name: Events.TABLE_RECORD_CREATE }, () => ['addRecord'])
      .with({ name: Events.TABLE_RECORD_UPDATE }, () => ['setRecord'])
      .with({ name: Events.TABLE_RECORD_DELETE }, () => ['deleteRecord'])
      .otherwise(() => []);

    if (!isEmpty(buffer)) {
      this.emitActionTrigger(
        tableId,
        buffer.map((actionKey) => ({ actionKey }))
      );
    }
  }

  private isTableViewUpdateEvent(event: IListenerEvent): boolean {
    return Events.TABLE_VIEW_UPDATE === event.name;
  }

  private isTableFieldUpdateEvent(event: IListenerEvent): boolean {
    return Events.TABLE_FIELD_UPDATE === event.name;
  }

  private isTableFieldCreateEvent(event: IListenerEvent): boolean {
    return Events.TABLE_FIELD_CREATE === event.name;
  }

  private isTableFieldDeleteEvent(event: IListenerEvent): boolean {
    return Events.TABLE_FIELD_DELETE === event.name;
  }

  private isValidViewUpdateOperation(event: ViewUpdateEvent): boolean | undefined {
    const propertyKeys = ['filter', 'group'];
    const { name, propertyKey } = event.context.opMeta || {};
    return name === OpName.UpdateViewColumnMeta || propertyKeys.includes(propertyKey as string);
  }

  private isValidFieldUpdateOperation(event: FieldUpdateEvent): boolean | undefined {
    const propertyKeys = ['options', 'dbFieldType'];
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

  private emitActionTrigger(tableIdOrViewId: string, data: IActionTriggerData[]) {
    const channel = getActionTriggerChannel(tableIdOrViewId);

    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(tableIdOrViewId);
    localPresence.submit(data, (error) => {
      error && this.logger.error(error);
    });
  }
}
