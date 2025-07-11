/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateBaseVo, IDuplicateBaseRo } from '@teable/openapi';
import { Knex } from 'knex';
import { groupBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { TableDuplicateService } from '../table/table-duplicate.service';
import { BaseExportService } from './base-export.service';
import { BaseImportService } from './base-import.service';

@Injectable()
export class BaseDuplicateService {
  private logger = new Logger(BaseDuplicateService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly tableDuplicateService: TableDuplicateService,
    private readonly baseExportService: BaseExportService,
    private readonly baseImportService: BaseImportService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async duplicateBase(duplicateBaseRo: IDuplicateBaseRo, allowCrossBase: boolean = true) {
    const { fromBaseId, spaceId, withRecords, name, baseId } = duplicateBaseRo;

    const { base, tableIdMap, fieldIdMap, viewIdMap } = await this.duplicateStructure(
      fromBaseId,
      spaceId,
      name,
      allowCrossBase,
      baseId
    );

    const crossBaseLinkFieldTableMap = allowCrossBase
      ? ({} as Record<
          string,
          {
            dbFieldName: string;
            selfKeyName: string;
            isMultipleCellValue: boolean;
          }[]
        >)
      : await this.getCrossBaseLinkFieldTableMap(tableIdMap);

    if (withRecords) {
      await this.duplicateTableData(tableIdMap, fieldIdMap, viewIdMap, crossBaseLinkFieldTableMap);
      await this.duplicateAttachments(tableIdMap, fieldIdMap);
      await this.duplicateLinkJunction(tableIdMap, fieldIdMap, allowCrossBase);
    }

    return base as ICreateBaseVo;
  }

  private async getCrossBaseLinkFieldTableMap(tableIdMap: Record<string, string>) {
    const tableId2DbFieldNameMap: Record<
      string,
      { dbFieldName: string; selfKeyName: string; isMultipleCellValue: boolean }[]
    > = {};
    const prisma = this.prismaService.txClient();
    const allFieldRaws = await prisma.field.findMany({
      where: {
        tableId: { in: Object.keys(tableIdMap) },
        deletedTime: null,
      },
    });

    const crossBaseLinkFields = allFieldRaws
      .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
      .map((f) => ({ ...createFieldInstanceByRaw(f), tableId: f.tableId }))
      .filter((f) => (f.options as ILinkFieldOptions).baseId);

    const groupedCrossBaseLinkFields = groupBy(crossBaseLinkFields, 'tableId');

    Object.entries(groupedCrossBaseLinkFields).map(([tableId, fields]) => {
      tableId2DbFieldNameMap[tableId] = fields.map(
        ({ dbFieldName, options, isMultipleCellValue }) => {
          return {
            dbFieldName,
            selfKeyName: (options as ILinkFieldOptions).selfKeyName,
            isMultipleCellValue: !!isMultipleCellValue,
          };
        }
      );
      tableId2DbFieldNameMap[tableIdMap[tableId]] = fields.map(
        ({ dbFieldName, options, isMultipleCellValue }) => {
          return {
            dbFieldName,
            selfKeyName: (options as ILinkFieldOptions).selfKeyName,
            isMultipleCellValue: !!isMultipleCellValue,
          };
        }
      );
    });

    return tableId2DbFieldNameMap;
  }

  protected async duplicateStructure(
    fromBaseId: string,
    spaceId: string,
    baseName?: string,
    allowCrossBase?: boolean,
    baseId?: string
  ) {
    const prisma = this.prismaService.txClient();
    const baseRaw = await prisma.base.findUniqueOrThrow({
      where: {
        id: fromBaseId,
        deletedTime: null,
      },
    });
    baseRaw.name = baseName || `${baseRaw.name} (Copy)`;
    const tableRaws = await prisma.tableMeta.findMany({
      where: {
        baseId: fromBaseId,
        deletedTime: null,
      },
      orderBy: {
        order: 'asc',
      },
    });
    const tableIds = tableRaws.map(({ id }) => id);
    const fieldRaws = await prisma.field.findMany({
      where: {
        tableId: {
          in: tableIds,
        },
        deletedTime: null,
      },
    });
    const viewRaws = await prisma.view.findMany({
      where: {
        tableId: {
          in: tableIds,
        },
        deletedTime: null,
      },
      orderBy: {
        order: 'asc',
      },
    });

    const structure = await this.baseExportService.generateBaseStructConfig({
      baseRaw,
      tableRaws,
      fieldRaws,
      viewRaws,
      allowCrossBase,
    });

    this.logger.log(`base-duplicate-service: Start to getting base structure config successfully`);

    const {
      base: newBase,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
    } = await this.baseImportService.createBaseStructure(spaceId, structure, baseId);

    return { base: newBase, tableIdMap, fieldIdMap, viewIdMap };
  }

  private async duplicateTableData(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    crossBaseLinkFieldTableMap: Record<
      string,
      { dbFieldName: string; selfKeyName: string; isMultipleCellValue: boolean }[]
    >
  ) {
    const prisma = this.prismaService.txClient();
    const tableId2DbTableNameMap: Record<string, string> = {};
    const allTableId = Object.keys(tableIdMap).concat(Object.values(tableIdMap));
    const sourceTableRaws = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: allTableId }, deletedTime: null },
      select: {
        id: true,
        dbTableName: true,
      },
    });
    const targetTableRaws = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: allTableId }, deletedTime: null },
      select: {
        id: true,
        dbTableName: true,
      },
    });
    sourceTableRaws.forEach((tableRaw) => {
      tableId2DbTableNameMap[tableRaw.id] = tableRaw.dbTableName;
    });

    const oldTableId = Object.keys(tableIdMap);

    const dbTableNames = targetTableRaws.map((tableRaw) => tableRaw.dbTableName);

    const allForeignKeyInfos = [] as {
      constraint_name: string;
      column_name: string;
      referenced_table_schema: string;
      referenced_table_name: string;
      referenced_column_name: string;
      dbTableName: string;
    }[];

    // delete foreign keys if(exist) then duplicate table data
    for (const dbTableName of dbTableNames) {
      const foreignKeysInfoSql = this.dbProvider.getForeignKeysInfo(dbTableName);
      const foreignKeysInfo = await this.prismaService.txClient().$queryRawUnsafe<
        {
          constraint_name: string;
          column_name: string;
          referenced_table_schema: string;
          referenced_table_name: string;
          referenced_column_name: string;
        }[]
      >(foreignKeysInfoSql);
      const newForeignKeyInfos = foreignKeysInfo.map((info) => ({
        ...info,
        dbTableName,
      }));
      allForeignKeyInfos.push(...newForeignKeyInfos);
    }

    for (const { constraint_name, column_name, dbTableName } of allForeignKeyInfos) {
      const dropForeignKeyQuery = this.knex.schema
        .alterTable(dbTableName, (table) => {
          table.dropForeign(column_name, constraint_name);
        })
        .toQuery();

      await prisma.$executeRawUnsafe(dropForeignKeyQuery);
    }

    for (const tableId of oldTableId) {
      const newTableId = tableIdMap[tableId];
      const oldDbTableName = tableId2DbTableNameMap[tableId];
      const newDbTableName = tableId2DbTableNameMap[newTableId];
      await this.tableDuplicateService.duplicateTableData(
        oldDbTableName,
        newDbTableName,
        viewIdMap,
        fieldIdMap,
        crossBaseLinkFieldTableMap[tableId] || []
      );
    }

    for (const {
      constraint_name: constraintName,
      column_name: columnName,
      referenced_table_schema: referencedTableSchema,
      referenced_table_name: referencedTableName,
      referenced_column_name: referencedColumnName,
      dbTableName,
    } of allForeignKeyInfos) {
      const addForeignKeyQuerySql = this.knex.schema
        .alterTable(dbTableName, (table) => {
          table
            .foreign(columnName, constraintName)
            .references(referencedColumnName)
            .inTable(`${referencedTableSchema}.${referencedTableName}`);
        })
        .toQuery();

      await prisma.$executeRawUnsafe(addForeignKeyQuerySql);
    }
  }

  private async duplicateAttachments(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>
  ) {
    for (const [sourceTableId, targetTableId] of Object.entries(tableIdMap)) {
      await this.tableDuplicateService.duplicateAttachments(
        sourceTableId,
        targetTableId,
        fieldIdMap
      );
    }
  }

  private async duplicateLinkJunction(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    allowCrossBase: boolean = true
  ) {
    await this.tableDuplicateService.duplicateLinkJunction(tableIdMap, fieldIdMap, allowCrossBase);
  }
}
