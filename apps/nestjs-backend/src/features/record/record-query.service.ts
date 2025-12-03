// TODO: move record service read related to record-query.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { TableDomain, type IRecord } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { Timing } from '../../utils/timing';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw, fieldCore2FieldInstance } from '../field/model/factory';
import { InjectRecordQueryBuilder, IRecordQueryBuilder } from './query-builder';

/**
 * Service for querying record data
 * This service is separated from RecordService to avoid circular dependencies
 */
@Injectable()
export class RecordQueryService {
  private readonly logger = new Logger(RecordQueryService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectRecordQueryBuilder() private readonly recordQueryBuilder: IRecordQueryBuilder
  ) {}

  /**
   * Get the database column name to query for a field
   * For lookup formula fields, use the standard field name
   */
  private getQueryColumnName(field: IFieldInstance): string {
    return field.dbFieldName;
  }
  /**
   * Get record snapshots in bulk by record IDs
   * This is a simplified version of RecordService.getSnapshotBulk for internal use
   */
  @Timing()
  async getSnapshotBulk(
    table: TableDomain,
    recordIds: string[]
  ): Promise<{ id: string; data: IRecord }[]> {
    if (recordIds.length === 0) {
      return [];
    }

    try {
      // Get table info

      const { qb: queryBuilder } = await this.recordQueryBuilder.createRecordQueryBuilder(
        table.dbTableName,
        {
          tableId: table.id,
          viewId: undefined,
          useQueryModel: true,
          restrictRecordIds: recordIds,
        }
      );
      const sql = queryBuilder.whereIn('__id', recordIds).toQuery();

      // Query records from database

      this.logger.debug(`Querying records: ${sql}`);

      const rawRecords = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ [key: string]: unknown }[]>(sql);

      const fields = table.fieldList.map((f) => fieldCore2FieldInstance(f));

      // Convert raw records to IRecord format
      const snapshots: { id: string; data: IRecord }[] = [];

      for (const rawRecord of rawRecords) {
        const recordId = rawRecord.__id as string;
        const createdTime = rawRecord.__created_time as string;
        const lastModifiedTime = rawRecord.__last_modified_time as string;

        const recordFields: { [fieldId: string]: unknown } = {};

        // Convert database values to cell values
        for (const field of fields) {
          const dbValue = rawRecord[this.getQueryColumnName(field)];
          const cellValue = field.convertDBValue2CellValue(dbValue);
          recordFields[field.id] = cellValue;
        }

        const record: IRecord = {
          id: recordId,
          fields: recordFields,
          createdTime,
          lastModifiedTime,
          createdBy: 'system', // Simplified for internal use
          lastModifiedBy: 'system', // Simplified for internal use
        };

        snapshots.push({
          id: recordId,
          data: record,
        });
      }

      return snapshots;
    } catch (error) {
      this.logger.error(`Failed to get snapshots for table ${table.id}: ${error}`);
      throw error;
    }
  }
}
