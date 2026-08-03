import type { LinkFieldCore } from '../field';
import type { TableDomain } from './table-domain';

/**
 * Tables domain object that manages a collection of table domains
 * This class encapsulates table collection operations and provides a clean API
 * for managing multiple tables with visited state tracking
 */
export class Tables {
  private readonly _tableDomains: Map<string, TableDomain>;
  private readonly _visited: Set<string>;
  private readonly _entryTableId: string;

  constructor(
    entryTableId: string,
    tableDomains: Map<string, TableDomain> = new Map(),
    visited: Set<string> = new Set()
  ) {
    this._entryTableId = entryTableId;
    this._tableDomains = new Map(tableDomains);
    this._visited = new Set(visited);
  }

  /**
   * Get all table domains as readonly map
   */
  get tableDomains(): ReadonlyMap<string, TableDomain> {
    return this._tableDomains;
  }

  /**
   * Get visited table IDs as readonly set
   */
  get visited(): ReadonlySet<string> {
    return this._visited;
  }

  /**
   * Get the entry table ID
   */
  get entryTableId(): string {
    return this._entryTableId;
  }

  /**
   * Get the number of tables
   */
  get size(): number {
    return this._tableDomains.size;
  }

  /**
   * Check if tables collection is empty
   */
  get isEmpty(): boolean {
    return this._tableDomains.size === 0;
  }

  /**
   * Add a table domain to the collection
   */
  addTable(tableId: string, tableDomain: TableDomain): void {
    this._tableDomains.set(tableId, tableDomain);
  }

  /**
   * Add multiple table domains to the collection
   */
  addTables(tables: Map<string, TableDomain>): void {
    for (const [tableId, tableDomain] of tables) {
      this._tableDomains.set(tableId, tableDomain);
    }
  }

  /**
   * Get a table domain by ID
   */
  getTable(tableId: string): TableDomain | undefined {
    return this._tableDomains.get(tableId);
  }

  mustGetTable(tableId: string): TableDomain {
    const table = this.getTable(tableId);
    if (!table) {
      throw new Error(`Table ${tableId} not found`);
    }
    return table;
  }

  getLinkForeignTable(field: LinkFieldCore): TableDomain | undefined {
    return this.getTable(field.options.foreignTableId);
  }

  mustGetLinkForeignTable(field: LinkFieldCore): TableDomain {
    const table = this.getLinkForeignTable(field);
    if (!table) {
      throw new Error(`Foreign table ${field.options.foreignTableId} not found`);
    }
    return table;
  }

  /**
   * Check if a table exists
   */
  hasTable(tableId: string): boolean {
    return this._tableDomains.has(tableId);
  }

  /**
   * Remove a table from the collection
   */
  removeTable(tableId: string): boolean {
    return this._tableDomains.delete(tableId);
  }

  /**
   * Mark a table as visited
   */
  markVisited(tableId: string): void {
    this._visited.add(tableId);
  }

  /**
   * Check if a table has been visited
   */
  isVisited(tableId: string): boolean {
    return this._visited.has(tableId);
  }

  /**
   * Get all table IDs
   */
  getTableIds(): string[] {
    return Array.from(this._tableDomains.keys());
  }

  /**
   * Get all table domains as array
   */
  getTableDomainByIdsArray(): TableDomain[] {
    return Array.from(this._tableDomains.values());
  }

  /**
   * Get all visited table IDs as array
   */
  getVisitedTableIds(): string[] {
    return Array.from(this._visited);
  }

  /**
   * Get the entry table domain
   */
  getEntryTable(): TableDomain | undefined {
    return this._tableDomains.get(this._entryTableId);
  }

  /**
   * Get the entry table domain, throw error if not found
   * @throws Error - If entry table is not found
   */
  mustGetEntryTable(): TableDomain {
    const entryTable = this.getEntryTable();
    if (!entryTable) {
      throw new Error(`Entry table ${this._entryTableId} not found`);
    }
    return entryTable;
  }

  getTableListByIds(ids: Iterable<string>): TableDomain[] {
    return [...ids].map((id) => this.getTable(id)).filter(Boolean) as TableDomain[];
  }

  /**
   * Get all foreign table domains (excluding the entry table)
   */
  getForeignTables(): Map<string, TableDomain> {
    const foreignTables = new Map<string, TableDomain>();

    for (const [tableId, tableDomain] of this._tableDomains) {
      if (tableId !== this._entryTableId) {
        foreignTables.set(tableId, tableDomain);
      }
    }

    return foreignTables;
  }

  /**
   * Get all foreign table IDs (excluding the entry table)
   */
  getForeignTableIds(): string[] {
    return this.getTableIds().filter((id) => id !== this._entryTableId);
  }

  /**
   * Check if a table is the entry table
   */
  isEntryTable(tableId: string): boolean {
    return tableId === this._entryTableId;
  }

  /**
   * Check if a table is a foreign table (not the entry table)
   */
  isForeignTable(tableId: string): boolean {
    return this.hasTable(tableId) && !this.isEntryTable(tableId);
  }

  /**
   * Filter tables by predicate
   */
  filterTables(predicate: (tableDomain: TableDomain, tableId: string) => boolean): TableDomain[] {
    const result: TableDomain[] = [];
    for (const [tableId, tableDomain] of this._tableDomains) {
      if (predicate(tableDomain, tableId)) {
        result.push(tableDomain);
      }
    }
    return result;
  }

  /**
   * Map tables to another type
   */
  mapTables<T>(mapper: (tableDomain: TableDomain, tableId: string) => T): T[] {
    const result: T[] = [];
    for (const [tableId, tableDomain] of this._tableDomains) {
      result.push(mapper(tableDomain, tableId));
    }
    return result;
  }

  /**
   * Get all related table IDs from all tables in the collection
   */
  getAllRelatedTableIds(): Set<string> {
    const allRelatedTableIds = new Set<string>();

    for (const tableDomain of this._tableDomains.values()) {
      const relatedTableIds = tableDomain.getAllForeignTableIds();
      for (const tableId of relatedTableIds) {
        allRelatedTableIds.add(tableId);
      }
    }

    return allRelatedTableIds;
  }

  /**
   * Get tables that are not yet visited
   */
  getUnvisitedTables(): Map<string, TableDomain> {
    const unvisitedTables = new Map<string, TableDomain>();

    for (const [tableId, tableDomain] of this._tableDomains) {
      if (!this._visited.has(tableId)) {
        unvisitedTables.set(tableId, tableDomain);
      }
    }

    return unvisitedTables;
  }

  /**
   * Get tables that have been visited
   */
  getVisitedTables(): Map<string, TableDomain> {
    const visitedTables = new Map<string, TableDomain>();

    for (const [tableId, tableDomain] of this._tableDomains) {
      if (this._visited.has(tableId)) {
        visitedTables.set(tableId, tableDomain);
      }
    }

    return visitedTables;
  }

  /**
   * Clear all tables and visited state
   */
  clear(): void {
    this._tableDomains.clear();
    this._visited.clear();
  }

  /**
   * Create a copy of the tables collection
   */
  clone(): Tables {
    return new Tables(this._entryTableId, this._tableDomains, this._visited);
  }

  /**
   * Convert to plain object representation
   */
  toPlainObject() {
    return {
      entryTableId: this._entryTableId,
      tables: Object.fromEntries(
        Array.from(this._tableDomains.entries()).map(([id, domain]) => [id, domain.toPlainObject()])
      ),
      foreignTables: Object.fromEntries(
        Array.from(this.getForeignTables().entries()).map(([id, domain]) => [
          id,
          domain.toPlainObject(),
        ])
      ),
      visited: Array.from(this._visited),
      size: this.size,
      isEmpty: this.isEmpty,
    };
  }

  /**
   * Iterator support for for...of loops over table domains
   */
  *[Symbol.iterator](): Iterator<[string, TableDomain]> {
    for (const entry of this._tableDomains) {
      yield entry;
    }
  }
}
