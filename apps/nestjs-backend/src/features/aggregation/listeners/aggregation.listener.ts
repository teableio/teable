import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  ISetColumnMetaOpContext,
  IRawAggregationVo,
  IRawRowCountVo,
} from '@teable-group/core';
import { getAggregationChannel, getRowCountChannel } from '@teable-group/core/dist/models/channel';
import { get } from 'lodash';
import { IEventBase } from '../../../event-emitter/interfaces/event-base.interface';
import type {
  FieldUpdatedEvent,
  RecordCreatedEvent,
  RecordUpdatedEvent,
  ViewUpdatedEvent,
} from '../../../event-emitter/model';
import { EventEnums } from '../../../event-emitter/model';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { IWithView } from '../aggregation.service';
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
    let calculateParams:
      | { tableId: string; withFieldIds?: string[]; withView?: IWithView }
      | undefined = undefined;
    const calculateConfig: { fieldAggregation?: boolean; rowCount?: boolean } = {
      fieldAggregation: true,
    };

    if ([EventEnums.RecordCreated, EventEnums.RecordUpdated].includes(event.eventName)) {
      const recordEvent = event as RecordCreatedEvent | RecordUpdatedEvent;
      let fieldIds: string[] | undefined;
      const { tableId, ops } = recordEvent;

      ops?.forEach((op) => {
        const fieldId = get(op, 'fieldId');
        fieldId && (fieldIds = fieldIds ?? []).push(fieldId);
      });

      calculateParams = {
        tableId,
        withFieldIds: fieldIds,
      };
      calculateConfig['rowCount'] = true;
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

      calculateParams = {
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
      calculateParams = {
        tableId,
        withView: {
          viewId,
        },
      };
      calculateConfig['rowCount'] = true;
    }

    if (calculateParams) {
      const { tableId } = calculateParams;
      this.aggregationService.performAggregation(calculateParams, calculateConfig, (data, error) =>
        this.emitAggregation(tableId, data, error)
      );
    }
  }

  private async emitAggregation(
    tableId: string,
    data: IRawAggregationVo | IRawRowCountVo | null,
    err?: unknown
  ): Promise<void> {
    if (err) {
      this.logger.error(err);
      return;
    }

    const firstData = data && Object.values(data)[0];

    let channel = undefined;
    if ('aggregations' in firstData) {
      channel = getAggregationChannel(tableId, firstData.viewId);
    }

    if ('rowCount' in firstData) {
      channel = getRowCountChannel(tableId, firstData.viewId);
    }

    if (firstData && channel) {
      const presence = this.shareDbService.connect().getPresence(channel);
      const localPresence = presence.create(firstData.viewId);
      localPresence.submit(data, (error) => {
        error && this.logger.error(error);
      });
    }
  }
}
