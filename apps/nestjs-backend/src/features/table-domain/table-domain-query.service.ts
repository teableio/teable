import { Injectable, NotFoundException } from '@nestjs/common';
import { TableDomain, Tables } from '@teable/core';
import type { FieldCore } from '@teable/core';
import type { Field, TableMeta } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
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
    private readonly cls: ClsService<IClsStore>
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
    const preloaded = this.getPreloadedTableDomain(tableId);
    if (preloaded) {
      return preloaded;
    }
    this.enableTableDomainDataLoader();
    const tableMeta = await this.getTableMetaById(tableId);
    const fieldRaws = await this.getTableFields(tableMeta.id);
    return this.buildTableDomain(tableMeta, fieldRaws);
  }

  primeTableDomains(tableDomains: Iterable<TableDomain>): void {
    if (!this.cls.isActive()) {
      return;
    }
    const existing = this.cls.get('preloadedTableDomains') ?? new Map<string, TableDomain>();
    for (const domain of tableDomains) {
      existing.set(domain.id, domain);
    }
    this.cls.set('preloadedTableDomains', existing);
  }

  /**
   * Get table metadata by ID
   * @private
   */
  private async getTableMetaById(tableId: string) {
    const [tableMeta] = (await this.dataLoaderService.table.loadByIds([tableId])) as TableMeta[];

    if (!tableMeta) {
      throw new NotFoundException(`Table with ID ${tableId} not found`);
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
  async getAllRelatedTableDomains(
    tableId: string,
    fieldIds?: string[],
    opts?: { preloaded?: ReadonlyMap<string, TableDomain> }
  ) {
    return this.#getAllRelatedTableDomains(
      tableId,
      undefined,
      undefined,
      fieldIds,
      opts?.preloaded
    );
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async #getAllRelatedTableDomains(
    tableId: string,
    tables: Tables = new Tables(tableId),
    level = 1,
    projectionFieldIds?: string[],
    preloaded?: ReadonlyMap<string, TableDomain>
  ): Promise<Tables> {
    // Prevent infinite recursion
    if (tables.isVisited(tableId)) {
      return tables;
    }

    const currentTableDomain = preloaded?.get(tableId) ?? (await this.getTableDomainById(tableId));
    tables.addTable(tableId, currentTableDomain);
    // Mark as visited
    tables.markVisited(tableId);

    const projection =
      level === 1 && projectionFieldIds && projectionFieldIds.length
        ? projectionFieldIds
        : undefined;
    const foreignTableIds = currentTableDomain.getAllForeignTableIds(projection);
    for (const foreignTableId of foreignTableIds) {
      try {
        await this.#getAllRelatedTableDomains(
          foreignTableId,
          tables,
          level + 1,
          undefined,
          preloaded
        );
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

  private enableTableDomainDataLoader() {
    if (!this.cls.isActive()) {
      return;
    }
    if (this.cls.get('dataLoaderCache.disabled')) {
      return;
    }
    const cacheKeys = this.cls.get('dataLoaderCache.cacheKeys');
    if (!cacheKeys) {
      return;
    }
    const requiredKeys: ('table' | 'field')[] = ['table', 'field'];
    const missingKeys = requiredKeys.filter((key) => !cacheKeys.includes(key));
    if (missingKeys.length) {
      this.cls.set('dataLoaderCache.cacheKeys', [...cacheKeys, ...missingKeys]);
    }
  }

  private getPreloadedTableDomain(tableId: string): TableDomain | undefined {
    if (!this.cls.isActive()) {
      return undefined;
    }
    const preloaded = this.cls.get('preloadedTableDomains');
    return preloaded?.get(tableId);
  }
}
