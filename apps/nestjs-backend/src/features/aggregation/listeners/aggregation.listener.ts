import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ISetColumnMetaOpContext, IViewAggregationVo } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import { get } from 'lodash';
import type {
  FieldUpdatedEvent,
  RecordCreatedEvent,
  RecordUpdatedEvent,
  ViewUpdatedEvent,
} from '../../../share-db/events';
import { EventEnums } from '../../../share-db/events';
import { IEventBase } from '../../../share-db/events/interfaces/event-base.interface';
import { ShareDbService } from '../../../share-db/share-db.service';
import { AggregationService } from '../aggregation.service';

@Injectable()
export class AggregationListener {
  private readonly logger = new Logger(AggregationListener.name);
  constructor(
    private readonly aggregationService: AggregationService,
    private readonly shareDbService: ShareDbService
  ) {}

  @OnEvent(EventEnums.RecordCreated, { async: true })
  @OnEvent(EventEnums.RecordUpdated, { async: true })
  @OnEvent(EventEnums.ViewUpdated, { async: true })
  @OnEvent(EventEnums.FieldUpdated, { async: true })
  private async onTableChange(event: IEventBase) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let calculate: any;

    if ([EventEnums.RecordCreated, EventEnums.RecordUpdated].includes(event.eventName)) {
      const recordEvent = event as RecordCreatedEvent | RecordUpdatedEvent;
      const fieldIds: string[] = [];
      const { tableId, ops } = recordEvent;

      ops?.forEach((op) => {
        const fieldId = get(op, 'fieldId');
        fieldId && fieldIds.push(fieldId as string);
      });

      calculate = {
        tableId,
        withFieldIds: fieldIds,
      };
    }

    if (
      EventEnums.FieldUpdated === event.eventName &&
      event.ops?.some((op) => {
        if (op.name === 'setColumnMeta') {
          const setColumnMetaOp = op as ISetColumnMetaOpContext;

          return (
            setColumnMetaOp.metaKey === 'statisticFunc' ||
            (setColumnMetaOp.metaKey === 'hidden' && !setColumnMetaOp.newMetaValue)
          );
        }
      })
    ) {
      const fieldEvent = event as FieldUpdatedEvent;
      const { tableId, fieldId, ops } = fieldEvent;

      const viewId = (ops[0] as ISetColumnMetaOpContext).viewId;

      calculate = {
        tableId,
        withView: {
          viewId,
          customFieldStats: [
            {
              fieldId,
            },
          ],
        },
      };
    }

    if (
      EventEnums.ViewUpdated === event.eventName &&
      event.ops?.some((op) => {
        return op.name === 'setViewFilter';
      })
    ) {
      const viewEvent = event as ViewUpdatedEvent;
      const { tableId, viewId } = viewEvent;
      calculate = {
        tableId,
        withView: {
          viewId,
        },
      };
    }

    if (calculate) {
      this.aggregationService.calculateAggregations(calculate, (data, error) =>
        this.emitAggregation((calculate as { tableId: string }).tableId, data, error)
      );
    }
  }

  private async emitAggregation(
    tableId: string,
    data?: IViewAggregationVo,
    err?: unknown
  ): Promise<void> {
    if (err) {
      this.logger.error(err);
      return;
    }

    const viewAggregation = data && Object.values(data)[0];

    if (viewAggregation) {
      const channel = `${IdPrefix.View}_${tableId}_${viewAggregation.viewId}_aggregation`;
      const presence = this.shareDbService.connect().getPresence(channel);
      const localPresence = presence.create(viewAggregation.viewId);
      localPresence.submit(data, (error) => {
        error && this.logger.error(error);
      });
    }
  }
}
