import { Injectable, NotFoundException } from '@nestjs/common';
import { TableDomain, Tables } from '@teable/core';
import type { FieldCore } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { createFieldInstanceByVo, rawField2FieldObj } from '../../../field/model/factory';

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
    // Fetch table metadata and fields in parallel for better performance
    const [tableMeta, fieldRaws] = await Promise.all([
      this.getTableMetadata(tableId),
      this.getTableFields(tableId),
    ]);

    // Convert raw field data to FieldCore instances
    const fieldInstances = fieldRaws.map((fieldRaw) => {
      const fieldVo = rawField2FieldObj(fieldRaw);
      return createFieldInstanceByVo(fieldVo) as FieldCore;
    });

    // Construct and return the TableDomain object
    return new TableDomain({
      id: tableMeta.id,
      name: tableMeta.name,
      dbTableName: tableMeta.dbTableName,
      icon: tableMeta.icon || undefined,
      description: tableMeta.description || undefined,
      lastModifiedTime:
        tableMeta.lastModifiedTime?.toISOString() || tableMeta.createdTime.toISOString(),
      defaultViewId: tableMeta.defaultViewId,
      baseId: tableMeta.baseId,
      fields: fieldInstances,
    });
  }

  /**
   * Get table metadata by ID
   * @private
   */
  private async getTableMetadata(tableId: string) {
    const tableMeta = await this.prismaService.txClient().tableMeta.findFirst({
      where: {
        id: tableId,
        deletedTime: null,
      },
      include: {
        views: {
          where: { deletedTime: null },
          select: { id: true },
          orderBy: { order: 'asc' },
          take: 1,
        },
      },
    });

    if (!tableMeta) {
      throw new NotFoundException(`Table with ID ${tableId} not found`);
    }

    if (!tableMeta.views.length) {
      throw new NotFoundException(`No views found for table ${tableId}`);
    }

    return {
      ...tableMeta,
      defaultViewId: tableMeta.views[0].id,
    };
  }

  /**
   * Get all related table domains recursively
   * This method will fetch the current table domain and all tables it references
   * through link fields and formula fields that reference link fields
   *
   * @param tableId - The root table ID to start from
   * @param tables - Optional Tables object to continue building on
   * @returns Promise<Tables> - Tables domain object containing all related table domains
   */
  async getAllRelatedTableDomains(tableId: string, tables?: Tables): Promise<Tables> {
    // Create new Tables instance if not provided, using tableId as entry table
    if (!tables) {
      tables = new Tables(tableId);
    }
    // Prevent infinite recursion
    if (tables.isVisited(tableId)) {
      return tables;
    }

    // Mark as visited
    tables.markVisited(tableId);

    // Get the current table domain
    const currentTableDomain = await this.getTableDomainById(tableId);
    tables.addTable(tableId, currentTableDomain);

    // Get all related table IDs (including through formula fields)
    const relatedTableIds = currentTableDomain.getAllRelatedTableIds();

    // Recursively fetch related table domains
    for (const relatedTableId of relatedTableIds) {
      if (!tables.isVisited(relatedTableId)) {
        await this.getAllRelatedTableDomains(relatedTableId, tables);
      }
    }

    return tables;
  }

  /**
   * Get all fields for a table
   * @private
   */
  private async getTableFields(tableId: string) {
    return await this.prismaService.txClient().field.findMany({
      where: {
        tableId,
        deletedTime: null,
      },
      orderBy: [
        {
          isPrimary: {
            sort: 'asc',
            nulls: 'last',
          },
        },
        {
          order: 'asc',
        },
        {
          createdTime: 'asc',
        },
      ],
    });
  }
}
