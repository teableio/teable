import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateBaseVo, IDuplicateBaseRo } from '@teable/openapi';
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
    private readonly baseImportService: BaseImportService
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
    const tableRaws = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: allTableId }, deletedTime: null },
      select: {
        id: true,
        dbTableName: true,
      },
    });
    tableRaws.forEach((tableRaw) => {
      tableId2DbTableNameMap[tableRaw.id] = tableRaw.dbTableName;
    });

    const oldTableId = Object.keys(tableIdMap);
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
