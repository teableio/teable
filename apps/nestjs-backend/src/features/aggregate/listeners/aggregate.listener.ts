import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IViewAggregateVo } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import { get } from 'lodash';
import type { FieldEvent, RecordEvent, ViewEvent } from '../../../share-db/events';
import { EventEnums } from '../../../share-db/events';
import { IEventBase } from '../../../share-db/events/interfaces/event-base.interface';
import { ShareDbService } from '../../../share-db/share-db.service';
import { AggregateService } from '../aggregate.service';

@Injectable()
export class AggregateListener {
  private readonly logger = new Logger(AggregateListener.name);
  constructor(
    private readonly aggregateService: AggregateService,
    private readonly shareDbService: ShareDbService
  ) {}

  @OnEvent(EventEnums.RecordCreated, { async: true })
  @OnEvent(EventEnums.RecordUpdated, { async: true })
  @OnEvent(EventEnums.ViewCreated, { async: true })
  @OnEvent(EventEnums.ViewUpdated, { async: true })
  @OnEvent(EventEnums.FieldCreated, { async: true })
  @OnEvent(EventEnums.FieldUpdated, { async: true })
  private async onTableChange(event: IEventBase) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let calculate: any;

    if ([EventEnums.RecordCreated, EventEnums.RecordUpdated].includes(event.eventName)) {
      const recordEvent = event as RecordEvent;
      const fieldIds: string[] = [];
      const { tableId, ops } = recordEvent;
      ops.forEach((op) => {
        const fieldId = get(op, 'fieldId');
        fieldId && fieldIds.push(fieldId as string);
      });

      calculate = {
        tableId,
        withFieldIds: fieldIds,
      };
    }

    if ([EventEnums.FieldCreated, EventEnums.FieldUpdated].includes(event.eventName)) {
      const fieldEvent = event as FieldEvent;
      const { tableId, fieldId } = fieldEvent;
      calculate = {
        tableId,
        withFieldIds: [fieldId],
      };
    }

    if ([EventEnums.ViewCreated, EventEnums.ViewUpdated].includes(event.eventName)) {
      const viewEvent = event as ViewEvent;
      const { tableId, viewId } = viewEvent;
      calculate = {
        tableId,
        withView: {
          viewId,
        },
      };
    }

    if (calculate) {
      this.aggregateService.calculateAggregates(calculate, (data, error) =>
        this.emitAggregate((calculate as { tableId: string }).tableId, data, error)
      );
    }
  }

  private async emitAggregate(
    tableId: string,
    data?: IViewAggregateVo,
    err?: unknown
  ): Promise<void> {
    if (err) {
      this.logger.error(err);
      return;
    }

    const viewAggregate = data && Object.values(data)[0];

    if (viewAggregate) {
      const channel = `${IdPrefix.View}_${tableId}_${viewAggregate.viewId}_aggregate`;
      const presence = this.shareDbService.connect().getPresence(channel);
      const localPresence = presence.create(viewAggregate.viewId);
      localPresence.submit(data, (error) => {
        error && this.logger.error(error);
      });
    }
  }
}
