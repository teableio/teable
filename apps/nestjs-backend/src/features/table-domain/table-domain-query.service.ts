import { Injectable, NotFoundException } from '@nestjs/common';
import { TableDomain, Tables } from '@teable/core';
import type { FieldCore } from '@teable/core';
import type { Field, TableMeta } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { rawField2FieldObj, createFieldInstanceByVo } from '../field/model/factory';

/**
 * Service for querying and constructing table domain objects
 * This service is responsible for fetching table metadata and fields,
 * then constructing complete TableDomain objects for record queries
 */
@Injectable()
export class TableDomainQueryService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Get a complete table domain object by table ID
   * This method fetches both table metadata and all associated fields,
   * then constructs a TableDomain object with a Fields collection
   *
   * @param tableId - The ID of the table to fetch
   * @returns Promise<TableDomain> - Complete table domain object with fields
   * @throws NotFoundException - If table is not found or has been deleted
   */
  async getTableDomainById(tableId: string): Promise<TableDomain> {
    const tableMeta = await this.getTableMetaById(tableId);
    const fieldRaws = await this.getTableFields(tableMeta.id);
    return this.buildTableDomain(tableMeta, fieldRaws);
  }

  /**
   * Get a complete table domain object by dbTableName
   * @param dbTableName - The physical table name in the database
   */
  async getTableDomainByDbTableName(dbTableName: string): Promise<TableDomain> {
    const tableMeta = await this.getTableMetaByDbTableName(dbTableName);
    const fieldRaws = await this.getTableFields(tableMeta.id);
    return this.buildTableDomain(tableMeta, fieldRaws);
  }

  /**
   * Get table metadata by ID
   * @private
   */
  private async getTableMetaById(tableId: string) {
    const tableMeta = await this.prismaService.txClient().tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
    });

    if (!tableMeta) {
      throw new NotFoundException(`Table with ID ${tableId} not found`);
    }

    return tableMeta;
  }

  private async getTableMetaByDbTableName(dbTableName: string) {
    const tableMeta = await this.prismaService.txClient().tableMeta.findFirst({
      where: { dbTableName, deletedTime: null },
    });

    if (!tableMeta) {
      throw new NotFoundException(`Table with dbTableName ${dbTableName} not found`);
    }

    return tableMeta;
  }

  private async getTableFields(tableId: string) {
    return this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      orderBy: [
        {
          isPrimary: {
            sort: 'asc',
            nulls: 'last',
          },
        },
        { order: 'asc' },
        { createdTime: 'asc' },
      ],
    });
  }

  private buildTableDomain(tableMeta: TableMeta, fieldRaws: Field[]): TableDomain {
    const fieldInstances = fieldRaws.map((fieldRaw) => {
      const fieldVo = rawField2FieldObj(fieldRaw);
      return createFieldInstanceByVo(fieldVo) as FieldCore;
    });

    return new TableDomain({
      id: tableMeta.id,
      name: tableMeta.name,
      dbTableName: tableMeta.dbTableName,
      dbViewName: tableMeta.dbViewName ?? undefined,
      icon: tableMeta.icon || undefined,
      description: tableMeta.description || undefined,
      lastModifiedTime:
        tableMeta.lastModifiedTime?.toISOString() || tableMeta.createdTime.toISOString(),
      baseId: tableMeta.baseId,
      fields: fieldInstances,
    });
  }

  /**
   * Get all related table domains recursively
   * This method will fetch the current table domain and all tables it references
   * through link fields and formula fields that reference link fields
   *
   * @param tableId - The root table ID to start from
   * @returns Promise<Tables> - Tables domain object containing all related table domains
   */
  async getAllRelatedTableDomains(tableId: string) {
    return this.#getAllRelatedTableDomains(tableId);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async #getAllRelatedTableDomains(
    tableId: string,
    tables: Tables = new Tables(tableId),
    level = 1
  ): Promise<Tables> {
    // Prevent infinite recursion
    if (tables.isVisited(tableId)) {
      return tables;
    }

    const currentTableDomain = await this.getTableDomainById(tableId);
    tables.addTable(tableId, currentTableDomain);
    // Mark as visited
    tables.markVisited(tableId);

    const foreignTableIds = currentTableDomain.getAllForeignTableIds();
    for (const foreignTableId of foreignTableIds) {
      try {
        await this.#getAllRelatedTableDomains(foreignTableId, tables, level + 1);
      } catch (e) {
        // If the related table was deleted or not found, skip it gracefully
        if (e?.constructor?.name === 'NotFoundException') {
          continue;
        }
        throw e;
      }
    }

    return tables;
  }
}
