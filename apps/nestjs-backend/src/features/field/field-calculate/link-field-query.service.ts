import { Injectable } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IFieldInstance } from '../model/factory';

@Injectable()
export class LinkFieldQueryService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Get table name mapping for link field operations
   * @param tableId Current table ID
   * @param fieldInstances Field instances that may contain link fields
   * @returns Map of tableId -> dbTableName for all related tables
   */
  async getTableNameMapForLinkFields(
    tableId: string,
    fieldInstances: IFieldInstance[]
  ): Promise<Map<string, string>> {
    const tableIds = new Set<string>([tableId]);

    // Collect all foreign table IDs from link fields
    for (const field of fieldInstances) {
      if (field.type === FieldType.Link && !field.isLookup) {
        const options = field.options as ILinkFieldOptions;
        if (options.foreignTableId) {
          tableIds.add(options.foreignTableId);
        }
      }
    }

    // Query all related tables
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: Array.from(tableIds) } },
      select: { id: true, dbTableName: true },
    });

    return new Map(tables.map((table) => [table.id, table.dbTableName]));
  }

  /**
   * Get table name mapping for a specific table and its link fields
   * @param tableId Table ID
   * @returns Map of tableId -> dbTableName for the table and all its foreign tables
   */
  async getTableNameMapForTable(tableId: string): Promise<Map<string, string>> {
    // Get all link fields for this table
    const linkFields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId,
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
      select: { options: true },
    });

    const tableIds = new Set<string>([tableId]);

    // Collect foreign table IDs
    for (const field of linkFields) {
      if (field.options) {
        const options = JSON.parse(field.options as string) as ILinkFieldOptions;
        if (options.foreignTableId) {
          tableIds.add(options.foreignTableId);
        }
      }
    }

    // Query all related tables
    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: Array.from(tableIds) } },
      select: { id: true, dbTableName: true },
    });

    return new Map(tables.map((table) => [table.id, table.dbTableName]));
  }

  /**
   * Get table ID from database table name
   * @param dbTableName Database table name
   * @returns Table ID
   */
  async getTableIdFromDbTableName(dbTableName: string): Promise<string | null> {
    const table = await this.prismaService.txClient().tableMeta.findFirst({
      where: { dbTableName },
      select: { id: true },
    });

    return table?.id || null;
  }

  /**
   * Get database table name from table ID
   * @param tableId Table ID
   * @returns Database table name
   */
  async getDbTableNameFromTableId(tableId: string): Promise<string | null> {
    const table = await this.prismaService.txClient().tableMeta.findFirst({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    return table?.dbTableName || null;
  }

  /**
   * Check if any field instances contain link fields
   * @param fieldInstances Field instances to check
   * @returns True if any link fields are found
   */
  hasLinkFields(fieldInstances: IFieldInstance[]): boolean {
    return fieldInstances.some((field) => field.type === FieldType.Link && !field.isLookup);
  }

  /**
   * Get all foreign table IDs from link field instances
   * @param fieldInstances Field instances
   * @returns Set of foreign table IDs
   */
  getForeignTableIds(fieldInstances: IFieldInstance[]): Set<string> {
    const foreignTableIds = new Set<string>();

    for (const field of fieldInstances) {
      if (field.type === FieldType.Link && !field.isLookup) {
        const options = field.options as ILinkFieldOptions;
        if (options.foreignTableId) {
          foreignTableIds.add(options.foreignTableId);
        }
      }
    }

    return foreignTableIds;
  }
}
