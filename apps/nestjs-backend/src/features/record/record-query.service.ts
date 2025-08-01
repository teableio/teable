// TODO: move record service read related to record-query.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { FieldType, type IRecord } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { Timing } from '../../utils/timing';
import { FieldSelectVisitor } from '../field/field-select-visitor';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import type { FormulaFieldDto } from '../field/model/field-dto/formula-field.dto';

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
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  /**
   * Get the database column name to query for a field
   * For formula fields with dbGenerated=true, use the generated column name
   * For lookup formula fields, use the standard field name
   */
  private getQueryColumnName(field: IFieldInstance): string {
    if (field.type === FieldType.Formula && !field.isLookup) {
      const formulaField = field as FormulaFieldDto;
      if (formulaField.options.dbGenerated) {
        return formulaField.getGeneratedColumnName();
      }
    }
    return field.dbFieldName;
  }
  /**
   * Get record snapshots in bulk by record IDs
   * This is a simplified version of RecordService.getSnapshotBulk for internal use
   */
  @Timing()
  async getSnapshotBulk(
    tableId: string,
    recordIds: string[]
  ): Promise<{ id: string; data: IRecord }[]> {
    if (recordIds.length === 0) {
      return [];
    }

    try {
      // Get table info
      const table = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: { id: tableId },
        select: { id: true, name: true, dbTableName: true },
      });

      // Get field info
      const fieldRaws = await this.prismaService.txClient().field.findMany({
        where: { tableId, deletedTime: null },
      });

      const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));

      const qb = this.knex(table.dbTableName);

      const context = {
        fieldMap: fields.reduce(
          (acc, field) => {
            acc[field.id] = {
              columnName: field.dbFieldName,
              fieldType: field.type,
              dbGenerated: field.type === FieldType.Formula && field.options.dbGenerated,
            };

            return acc;
          },
          {} as Record<string, { columnName: string; fieldType: string; dbGenerated: boolean }>
        ),
      };

      const visitor = new FieldSelectVisitor(this.knex, qb, this.dbProvider, context);

      qb.select(['__id', '__version', '__created_time', '__last_modified_time']);

      for (const field of fields) {
        field.accept(visitor);
      }

      // Query records from database
      const query = qb.whereIn('__id', recordIds);

      this.logger.debug(`Querying records: ${query.toQuery()}`);

      const rawRecords = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ [key: string]: unknown }[]>(query.toQuery());

      // Convert raw records to IRecord format
      const snapshots: { id: string; data: IRecord }[] = [];

      for (const rawRecord of rawRecords) {
        const recordId = rawRecord.__id as string;
        const version = rawRecord.__version as number;
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
      this.logger.error(`Failed to get snapshots for table ${tableId}: ${error}`);
      throw error;
    }
  }
}
