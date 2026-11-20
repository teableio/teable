import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FieldKeyType } from '@teable/core';
import type { RecordOpenApiService } from './record-open-api.service';
import type { IRestorableRecordSnapshot } from './record-restore-native.service';

export const RECORD_RESTORE_V1_CREATE_RECORDS = Symbol('RECORD_RESTORE_V1_CREATE_RECORDS');

// The legacy record module owns this adapter and its create-records token. Native
// restoration never imports or instantiates the legacy record engine.
@Injectable()
export class RecordRestoreV1CompatibilityService {
  constructor(private readonly moduleRef: ModuleRef) {}

  async restoreRecordSnapshots(
    tableId: string,
    records: IRestorableRecordSnapshot[]
  ): Promise<void> {
    const recordOpenApiService = this.moduleRef.get<
      Pick<RecordOpenApiService, 'multipleCreateRecords'>
    >(RECORD_RESTORE_V1_CREATE_RECORDS, { strict: false });
    await recordOpenApiService.multipleCreateRecords(
      tableId,
      { fieldKeyType: FieldKeyType.Id, records, typecast: true },
      true
    );
  }
}
