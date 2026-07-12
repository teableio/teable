import { Injectable } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import type { IMakeOptional } from '@teable/core';
import type {
  IRecord,
  ICreateRecordsRo,
  ICreateRecordsVo,
  IRecordInsertOrderRo,
} from '@teable/openapi';
import { SpaceDataDbMigrationGuardService } from '../../space/space-data-db-migration-guard.service';
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
    private readonly tableDomainQueryService: TableDomainQueryService,
    private readonly spaceDataDbMigrationGuard: SpaceDataDbMigrationGuardService
  ) {}

  private async assertTableWritable(tableId: string) {
    await this.spaceDataDbMigrationGuard.assertTableRecordWritable(tableId);
  }

  async updateRecords(
    tableId: string,
    updateRecordsRo: IUpdateRecordsInternalRo,
    windowId?: string
  ) {
    await this.assertTableWritable(tableId);
    return this.updateService.updateRecords(tableId, updateRecordsRo, windowId);
  }

  async simpleUpdateRecords(tableId: string, updateRecordsRo: IUpdateRecordsInternalRo) {
    await this.assertTableWritable(tableId);
    return this.updateService.simpleUpdateRecords(tableId, updateRecordsRo);
  }

  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    ignoreMissingFields: boolean = false
  ): Promise<ICreateRecordsVo> {
    await this.assertTableWritable(tableId);
    return this.createService.multipleCreateRecords(tableId, createRecordsRo, ignoreMissingFields);
  }

  async createRecords(
    tableId: string,
    recordsRo: IMakeOptional<IRecordInnerRo, 'id'>[],
    fieldKeyType?: FieldKeyType,
    projection?: string[]
  ): Promise<ICreateRecordsVo> {
    await this.assertTableWritable(tableId);
    const table = await this.tableDomainQueryService.getTableDomainById(tableId);
    return this.createService.createRecords(
      table,
      recordsRo,
      fieldKeyType ?? FieldKeyType.Name,
      projection
    );
  }

  async createRecordsOnlySql(tableId: string, createRecordsRo: ICreateRecordsRo): Promise<void> {
    await this.assertTableWritable(tableId);
    return this.createService.createRecordsOnlySql(tableId, createRecordsRo);
  }

  async deleteRecord(tableId: string, recordId: string, windowId?: string) {
    await this.assertTableWritable(tableId);
    return this.deleteService.deleteRecord(tableId, recordId, windowId);
  }

  async deleteRecords(tableId: string, recordIds: string[], windowId?: string) {
    await this.assertTableWritable(tableId);
    return this.deleteService.deleteRecords(tableId, recordIds, windowId);
  }

  async duplicateRecord(
    tableId: string,
    recordId: string,
    order: IRecordInsertOrderRo,
    projection?: string[]
  ): Promise<IRecord> {
    await this.assertTableWritable(tableId);
    return this.duplicateService.duplicateRecord(tableId, recordId, order, projection);
  }
}
