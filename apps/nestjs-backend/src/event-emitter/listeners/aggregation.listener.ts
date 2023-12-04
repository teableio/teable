import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IRawAggregationVo, IRawRowCountVo } from '@teable-group/core';
import { getAggregationChannel, getRowCountChannel } from '@teable-group/core';
import type { IWithView } from '../../features/aggregation/aggregation.service';
import { AggregationService } from '../../features/aggregation/aggregation.service';
import { ShareDbService } from '../../share-db/share-db.service';
import { IBaseEvent } from '../interfaces/base-event.interface';
import type { RecordDeleteEvent } from '../model';
import { RecordUpdateEvent, Events, RecordCreateEvent } from '../model';

@Injectable()
export class AggregationListener {
  private readonly logger = new Logger(AggregationListener.name);
  constructor(
    private readonly aggregationService: AggregationService,
    private readonly shareDbService: ShareDbService
  ) {}

  @OnEvent('table.**', { async: true })
  private async listener(event: IBaseEvent): Promise<void> {
    let calculateParams:
      | { tableId: string; withFieldIds?: string[]; withView?: IWithView }
      | undefined = undefined;
    const calculateConfig: { fieldAggregation?: boolean; rowCount?: boolean } = {
      fieldAggregation: true,
    };

    if (
      [Events.TABLE_RECORD_CREATE, Events.TABLE_RECORD_DELETE, Events.TABLE_RECORD_UPDATE].includes(
        event.name
      )
    ) {
      const recordEvent = event as RecordCreateEvent | RecordDeleteEvent | RecordUpdateEvent;
      let fieldIds: string[] | undefined;
      const { tableId } = recordEvent;

      if (recordEvent instanceof RecordCreateEvent) {
        fieldIds = Object.keys(recordEvent.record.fields);
        console.log(fieldIds);
        calculateConfig['rowCount'] = true;
      } else if (recordEvent instanceof RecordUpdateEvent) {
        fieldIds = Object.keys(recordEvent.newFields);
      } else {
        calculateConfig['rowCount'] = true;
      }

      calculateParams = {
        tableId,
        withFieldIds: fieldIds,
      };
    }

    // if (
    //   Events.FieldUpdated === event.eventName &&
    //   event.ops?.some((op) => {
    //     if (op.name === 'setColumnMeta') {
    //       const setColumnMetaOp = op as ISetColumnMetaOpContext;
    //
    //       return (
    //         setColumnMetaOp.metaKey === 'statisticFunc' ||
    //         (setColumnMetaOp.metaKey === 'hidden' && !setColumnMetaOp.newMetaValue)
    //       );
    //     }
    //   })
    // ) {
    //   const fieldEvent = event as FieldUpdatedEvent;
    //   const { tableId, fieldId, ops } = fieldEvent;
    //
    //   const viewId = (ops[0] as ISetColumnMetaOpContext).viewId;
    //
    //   calculateParams = {
    //     tableId,
    //     withView: {
    //       viewId,
    //       customFieldStats: [
    //         {
    //           fieldId,
    //         },
    //       ],
    //     },
    //   };
    // }
    //
    // if (
    //   Events.ViewUpdated === event.eventName &&
    //   event.ops?.some((op) => {
    //     return op.name === 'setViewFilter';
    //   })
    // ) {
    //   const viewEvent = event as ViewUpdatedEvent;
    //   const { tableId, viewId } = viewEvent;
    //   calculateParams = {
    //     tableId,
    //     withView: {
    //       viewId,
    //     },
    //   };
    //   calculateConfig['rowCount'] = true;
    // }

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
