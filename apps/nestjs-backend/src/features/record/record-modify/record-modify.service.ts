import { Injectable } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import type { IMakeOptional } from '@teable/core';
import type {
  IRecord,
  ICreateRecordsRo,
  ICreateRecordsVo,
  IRecordInsertOrderRo,
} from '@teable/openapi';
import { TableDomainQueryService } from '../../table-domain';
import type { IRecordInnerRo } from '../record.service';
import type { IUpdateRecordsInternalRo } from '../type';
import { RecordCreateService } from './record-create.service';
import { RecordDeleteService } from './record-delete.service';
import { RecordDuplicateService } from './record-duplicate.service';
import { RecordUpdateService } from './record-update.service';

@Injectable()
export class RecordModifyService {
  constructor(
    private readonly createService: RecordCreateService,
    private readonly updateService: RecordUpdateService,
    private readonly deleteService: RecordDeleteService,
    private readonly duplicateService: RecordDuplicateService,
    private readonly tableDomainQueryService: TableDomainQueryService
  ) {}

  async updateRecords(
    tableId: string,
    updateRecordsRo: IUpdateRecordsInternalRo,
    windowId?: string
  ) {
    return this.updateService.updateRecords(tableId, updateRecordsRo, windowId);
  }

  async simpleUpdateRecords(tableId: string, updateRecordsRo: IUpdateRecordsInternalRo) {
    return this.updateService.simpleUpdateRecords(tableId, updateRecordsRo);
  }

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    ignoreMissingFields: boolean = false
  ): Promise<ICreateRecordsVo> {
    return this.createService.multipleCreateRecords(tableId, createRecordsRo, ignoreMissingFields);
  }

  async createRecords(
    tableId: string,
    recordsRo: IMakeOptional<IRecordInnerRo, 'id'>[],
    fieldKeyType?: FieldKeyType,
    projection?: string[]
  ): Promise<ICreateRecordsVo> {
    const table = await this.tableDomainQueryService.getTableDomainById(tableId);
    return this.createService.createRecords(
      table,
      recordsRo,
      fieldKeyType ?? FieldKeyType.Name,
      projection
    );
  }

  async createRecordsOnlySql(tableId: string, createRecordsRo: ICreateRecordsRo): Promise<void> {
    return this.createService.createRecordsOnlySql(tableId, createRecordsRo);
  }

  async deleteRecord(tableId: string, recordId: string, windowId?: string) {
    return this.deleteService.deleteRecord(tableId, recordId, windowId);
  }

  async deleteRecords(tableId: string, recordIds: string[], windowId?: string) {
    return this.deleteService.deleteRecords(tableId, recordIds, windowId);
  }

  async duplicateRecord(
    tableId: string,
    recordId: string,
    order: IRecordInsertOrderRo,
    projection?: string[]
  ): Promise<IRecord> {
    return this.duplicateService.duplicateRecord(tableId, recordId, order, projection);
  }
}
