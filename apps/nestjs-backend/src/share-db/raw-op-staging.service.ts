import { Injectable, Logger } from '@nestjs/common';
import { HttpErrorCode, IdPrefix, type IOtOperation } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../custom.exception';
import { EventEmitterService } from '../event-emitter/event-emitter.service';
import type { IClsStore } from '../types/cls';
import { Timing } from '../utils/timing';
import type { IRawOp, IRawOpMap } from './interface';
import { RawOpType } from './interface';

/** Stages the existing ShareDB document protocol in the current host transaction. */
@Injectable()
export class RawOpStagingService {
  private readonly logger = new Logger(RawOpStagingService.name);

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  @Timing()
  saveRawOps(
    collectionId: string,
    opType: RawOpType,
    docType: IdPrefix,
    dataList: { docId: string; version: number; data?: unknown }[],
    options?: { publish?: boolean }
  ): IRawOpMap {
    const collection = `${docType}_${collectionId}`;
    const rawOpMap: IRawOpMap = { [collection]: {} };
    const baseRaw = {
      src: this.cls.getId() || 'unknown',
      seq: 1,
      m: { ts: Date.now() },
    };

    this.logger.verbose(`saveOp: ${baseRaw.src}-${collection}`);

    for (const { docId, version, data } of dataList) {
      let rawOp: IRawOp;
      if (opType === RawOpType.Create) {
        rawOp = {
          ...baseRaw,
          create: { type: 'json0', data },
          v: version,
        };
      } else if (opType === RawOpType.Del) {
        rawOp = { ...baseRaw, del: true, v: version };
      } else if (opType === RawOpType.Edit) {
        rawOp = { ...baseRaw, op: data as IOtOperation[], v: version };
      } else {
        throw new CustomHttpException(
          `unknown raw op type ${opType}`,
          HttpErrorCode.VALIDATION_ERROR,
          { localization: { i18nKey: 'httpErrors.custom.invalidOperation' } }
        );
      }
      rawOpMap[collection][docId] = rawOp;
    }
    this.eventEmitterService.freezeRecordEventContext([rawOpMap]);
    if (options?.publish !== false) this.publishRawOps(rawOpMap);
    return rawOpMap;
  }

  /** Stage prepared server operations only after transactional audit persistence. */
  publishRawOps(rawOpMap: IRawOpMap) {
    const previous = this.cls.get('tx.rawOpMaps') || [];
    previous.push(rawOpMap);
    this.cls.set('tx.rawOpMaps', previous);
  }
}
