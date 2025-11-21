/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable } from '@nestjs/common';
import { HttpErrorCode, TableDomain, Tables } from '@teable/core';
import type { FieldCore } from '@teable/core';
import type { Field, TableMeta } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { Timing } from '../../utils/timing';
import { DataLoaderService } from '../data-loader/data-loader.service';
import { rawField2FieldObj, createFieldInstanceByVo } from '../field/model/factory';

/**
 * Service for querying and constructing table domain objects
 * This service is responsible for fetching table metadata and fields,
 * then constructing complete TableDomain objects for record queries
 */
@Injectable()
export class TableDomainQueryService {
  constructor(
    private readonly dataLoaderService: DataLoaderService,
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService
  ) {}

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
    this.enableTableDomainDataLoader();
    const tableMeta = await this.getTableMetaById(tableId);
    const fieldRaws = await this.getTableFields(tableMeta.id);
    return this.buildTableDomain(tableMeta, fieldRaws);
  }

  async getTableDomainsByIds(tableIds: string[]): Promise<Map<string, TableDomain>> {
    const uniqueIds = Array.from(new Set(tableIds.filter(Boolean)));
    if (!uniqueIds.length) {
      return new Map();
    }

    const tableMetas = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: uniqueIds }, deletedTime: null },
      include: {
        fields: {
          where: { deletedTime: null },
        },
      },
    });

    const domainMap = new Map<string, TableDomain>();
    for (const tableMeta of tableMetas) {
      const sortedFields = this.sortFieldRaws(tableMeta.fields as Field[]);
      const domain = this.buildTableDomain(tableMeta, sortedFields);
      domainMap.set(tableMeta.id, domain);
    }

    return domainMap;
  }

  /**
   * Get table metadata by ID
   * @private
   */
  private async getTableMetaById(tableId: string) {
    const [tableMeta] = (await this.dataLoaderService.table.loadByIds([tableId])) as TableMeta[];

    if (!tableMeta) {
      throw new CustomHttpException(
        `Table not found with id: ${tableId}`,
        HttpErrorCode.NOT_FOUND,
        {
          localization: {
            i18nKey: 'httpErrors.table.notFound',
          },
        }
      );
    }

    return tableMeta;
  }

  private async getTableFields(tableId: string) {
    const fields = await this.dataLoaderService.field.load(tableId);
    return this.sortFieldRaws(fields as Field[]);
  }

  private sortFieldRaws(fieldRaws: Field[]): Field[] {
    return [...fieldRaws].sort((a, b) => {
      const primaryDiff = this.comparePrimaryRank(a.isPrimary, b.isPrimary);
      if (primaryDiff !== 0) {
        return primaryDiff;
      }

      const orderDiff = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) {
        return orderDiff;
      }

      return a.createdTime.getTime() - b.createdTime.getTime();
    });
  }

  private comparePrimaryRank(valueA?: boolean | null, valueB?: boolean | null) {
    const rank = (value?: boolean | null) => {
      if (value === true) {
        return 0;
      }
      if (value === false) {
        return 1;
      }
      return 2;
    };

    return rank(valueA) - rank(valueB);
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
   * @param fieldIds - Optional projection of field IDs to limit foreign table traversal on the entry table
   * @returns Promise<Tables> - Tables domain object containing all related table domains
   */
  @Timing()
  async getAllRelatedTableDomains(tableId: string, fieldIds?: string[]) {
    this.enableTableDomainDataLoader();
    return this.#getAllRelatedTableDomains(tableId, fieldIds);
  }

  async #getAllRelatedTableDomains(
    tableId: string,
    projectionFieldIds?: string[]
  ): Promise<Tables> {
    const tables = new Tables(tableId);
    const queue: Array<{ tableId: string; projection?: string[] }> = [
      { tableId, projection: projectionFieldIds },
    ];

    while (queue.length) {
      const batch = queue.splice(0);
      const idsToFetch = Array.from(
        new Set(batch.map((item) => item.tableId).filter((id) => !tables.isVisited(id)))
      );

      if (idsToFetch.length) {
        const domainMap = await this.getTableDomainsByIds(idsToFetch);

        if (!tables.hasTable(tableId) && !domainMap.has(tableId)) {
          throw new CustomHttpException(
            `Table not found with id: ${tableId}`,
            HttpErrorCode.NOT_FOUND,
            {
              localization: {
                i18nKey: 'httpErrors.table.notFound',
              },
            }
          );
        }

        for (const id of idsToFetch) {
          const domain = domainMap.get(id);
          if (!domain) {
            // Related table was deleted or not found; skip gracefully
            continue;
          }

          tables.addTable(id, domain);
          tables.markVisited(id);
        }
      }

      for (const { tableId: currentId, projection } of batch) {
        const domain = tables.getTable(currentId);
        if (!domain) {
          continue;
        }

        const fieldProjection =
          currentId === tableId && projection && projection.length ? projection : undefined;

        const foreignTableIds = domain.getAllForeignTableIds(fieldProjection);
        for (const foreignTableId of foreignTableIds) {
          if (!tables.isVisited(foreignTableId)) {
            queue.push({ tableId: foreignTableId });
          }
        }
      }
    }

    return tables;
  }

  private enableTableDomainDataLoader() {
    if (!this.cls.isActive()) {
      return;
    }
    if (this.cls.get('dataLoaderCache.disabled')) {
      return;
    }
    const cacheKeys = this.cls.get('dataLoaderCache.cacheKeys') ?? [];
    const requiredKeys: ('table' | 'field')[] = ['table', 'field'];
    const missingKeys = requiredKeys.filter((key) => !cacheKeys.includes(key));
    if (missingKeys.length) {
      this.cls.set('dataLoaderCache.cacheKeys', [...cacheKeys, ...missingKeys]);
    }
  }
}
