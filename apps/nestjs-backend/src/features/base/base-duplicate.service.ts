/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateBaseVo, IDuplicateBaseRo } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
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

  async duplicateBase(duplicateBaseRo: IDuplicateBaseRo) {
    const { fromBaseId, spaceId, withRecords, name } = duplicateBaseRo;

    const { base, tableIdMap, fieldIdMap, viewIdMap } = await this.duplicateStructure(
      fromBaseId,
      spaceId,
      name
    );

    if (withRecords) {
      await this.duplicateTableData(tableIdMap, fieldIdMap, viewIdMap);
      await this.duplicateAttachments(tableIdMap, fieldIdMap);
      await this.duplicateLinkJunction(tableIdMap, fieldIdMap);
    }

    return base as ICreateBaseVo;
  }

  protected async duplicateStructure(fromBaseId: string, spaceId: string, baseName?: string) {
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

    const structure = await this.baseExportService.generateBaseStructJson({
      baseRaw,
      tableRaws,
      fieldRaws,
      viewRaws,
      crossBase: true,
    });
    const {
      base: newBase,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
    } = await this.baseImportService.createBaseStructure(spaceId, structure);

    return { base: newBase, tableIdMap, fieldIdMap, viewIdMap };
  }

  private async duplicateTableData(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
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

    await this.prismaService.$tx(async (prisma) => {
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
          fieldIdMap
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
    });
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
    fieldIdMap: Record<string, string>
  ) {
    await this.tableDuplicateService.duplicateLinkJunction(tableIdMap, fieldIdMap);
  }
}
