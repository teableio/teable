import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  ISetViewColumnMetaOpContext,
  IRawAggregationVo,
  IRawRowCountVo,
  IOpContextBase,
} from '@teable-group/core';
import { getAggregationChannel, getRowCountChannel } from '@teable-group/core';
import { get, flattenDeep } from 'lodash';
import { IEventBase } from '../../../event-emitter/interfaces/event-base.interface';
import type {
  RecordCreatedEvent,
  RecordDeletedEvent,
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
  @OnEvent(EventEnums.RecordDeleted, { async: true })
  @OnEvent(EventEnums.ViewUpdated, { async: true })
  @OnEvent(EventEnums.FieldUpdated, { async: true })
  private async onTableChange(event: IEventBase) {
    let calculateParams:
      | { tableId: string; withFieldIds?: string[]; withView?: IWithView }
      | undefined = undefined;
    const calculateConfig: { fieldAggregation?: boolean; rowCount?: boolean } = {
      fieldAggregation: true,
    };

    if (
      [EventEnums.RecordCreated, EventEnums.RecordDeleted, EventEnums.RecordUpdated].includes(
        event.eventName
      )
    ) {
      const recordEvent = event as RecordCreatedEvent | RecordUpdatedEvent | RecordDeletedEvent;
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
      EventEnums.ViewUpdated === event.eventName &&
      this.opsHasOpName(event.ops, 'setViewColumnMeta')
    ) {
      // TODO remove recordId until event refactor
      const viewEvent = event as ViewUpdatedEvent & { recordId: string };
      const { tableId, viewId, recordId, ops } = viewEvent;
      const flattenOps = flattenDeep(ops) as ISetViewColumnMetaOpContext[];
      const customFieldStats = flattenOps.map((op) => ({
        fieldId: op.fieldId,
        statisticFunc: op.newColumnMeta?.statisticFunc,
      })) as IWithView['customFieldStats'];

      if (
        flattenOps.some(
          (op) => op?.newColumnMeta?.statisticFunc !== op?.oldColumnMeta?.statisticFunc
        )
      ) {
        calculateParams = {
          tableId,
          withView: {
            viewId: viewId || recordId,
            customFieldStats,
          },
        };
      }
    }

    if (
      EventEnums.ViewUpdated === event.eventName &&
      this.opsHasOpName(event.ops, 'setViewFilter')
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

  private opsHasOpName(ops: IOpContextBase[] | undefined, opName: string | string[]) {
    if (!ops) {
      return false;
    }

    // ops may be nested array, common in batch ops
    const flattenOps = flattenDeep(ops);
    return flattenOps.some((op) => {
      if (Array.isArray(opName)) {
        return opName.includes(op.name);
      }
      return op.name === opName;
    });
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
