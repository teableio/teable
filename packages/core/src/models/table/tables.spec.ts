/* eslint-disable @typescript-eslint/no-explicit-any */
import { plainToInstance } from 'class-transformer';
import { FieldType, DbFieldType, CellValueType, Relationship } from '../field/constant';
import { LinkFieldCore } from '../field/derivate/link.field';
import { SingleLineTextFieldCore } from '../field/derivate/single-line-text.field';
import type { IFieldVo } from '../field/field.schema';
import { TableDomain } from './table-domain';
import { Tables } from './tables';

describe('Tables', () => {
  let tables: Tables;
  let tableDomain1: TableDomain;
  let tableDomain2: TableDomain;

  const linkFieldJson: IFieldVo = {
    id: 'fldlink1',
    dbFieldName: 'fldlink1',
    name: 'Link Field 1',
    options: {
      relationship: Relationship.ManyOne,
      foreignTableId: 'tbl2',
      lookupFieldId: 'fldlookup1',
      fkHostTableName: 'dbTableName',
      selfKeyName: '__id',
      foreignKeyName: '__fk_fldlink1',
    },
    type: FieldType.Link,
    dbFieldType: DbFieldType.Json,
    cellValueType: CellValueType.String,
    isMultipleCellValue: false,
    isComputed: false,
  };

  const textFieldJson: IFieldVo = {
    id: 'fldtext1',
    dbFieldName: 'fldtext1',
    name: 'Text Field',
    options: {},
    type: FieldType.SingleLineText,
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    isMultipleCellValue: false,
    isComputed: false,
  };

  beforeEach(() => {
    const linkField = plainToInstance(LinkFieldCore, linkFieldJson);
    const textField = plainToInstance(SingleLineTextFieldCore, textFieldJson);

    tableDomain1 = new TableDomain({
      id: 'tbl1',
      name: 'Table 1',
      dbTableName: 'table_1',
      lastModifiedTime: '2023-01-01T00:00:00.000Z',
      fields: [linkField, textField],
    });

    tableDomain2 = new TableDomain({
      id: 'tbl2',
      name: 'Table 2',
      dbTableName: 'table_2',
      lastModifiedTime: '2023-01-01T00:00:00.000Z',
      fields: [textField],
    });

    tables = new Tables('tbl1');
  });

  describe('basic operations', () => {
    it('should start empty with entry table ID', () => {
      expect(tables.size).toBe(0);
      expect(tables.isEmpty).toBe(true);
      expect(tables.entryTableId).toBe('tbl1');
    });

    it('should add and retrieve tables', () => {
      tables.addTable('tbl1', tableDomain1);

      expect(tables.size).toBe(1);
      expect(tables.isEmpty).toBe(false);
      expect(tables.hasTable('tbl1')).toBe(true);
      expect(tables.getTable('tbl1')).toBe(tableDomain1);
    });

    it('should add multiple tables', () => {
      const tableMap = new Map([
        ['tbl1', tableDomain1],
        ['tbl2', tableDomain2],
      ]);

      tables.addTables(tableMap);

      expect(tables.size).toBe(2);
      expect(tables.hasTable('tbl1')).toBe(true);
      expect(tables.hasTable('tbl2')).toBe(true);
    });

    it('should remove tables', () => {
      tables.addTable('tbl1', tableDomain1);

      expect(tables.removeTable('tbl1')).toBe(true);
      expect(tables.size).toBe(0);
      expect(tables.hasTable('tbl1')).toBe(false);
      expect(tables.removeTable('nonexistent')).toBe(false);
    });
  });

  describe('entry table and foreign tables', () => {
    beforeEach(() => {
      tables.addTable('tbl1', tableDomain1); // Entry table
      tables.addTable('tbl2', tableDomain2); // Foreign table
    });

    it('should identify entry table correctly', () => {
      expect(tables.isEntryTable('tbl1')).toBe(true);
      expect(tables.isEntryTable('tbl2')).toBe(false);
      expect(tables.isForeignTable('tbl1')).toBe(false);
      expect(tables.isForeignTable('tbl2')).toBe(true);
    });

    it('should get entry table', () => {
      const entryTable = tables.getEntryTable();
      expect(entryTable).toBe(tableDomain1);
      expect(entryTable?.id).toBe('tbl1');
    });

    it('should get foreign tables', () => {
      const foreignTables = tables.getForeignTables();
      expect(foreignTables.size).toBe(1);
      expect(foreignTables.has('tbl2')).toBe(true);
      expect(foreignTables.has('tbl1')).toBe(false);
    });

    it('should get foreign table IDs', () => {
      const foreignTableIds = tables.getForeignTableIds();
      expect(foreignTableIds).toHaveLength(1);
      expect(foreignTableIds).toContain('tbl2');
      expect(foreignTableIds).not.toContain('tbl1');
    });
  });

  describe('visited state management', () => {
    beforeEach(() => {
      tables.addTable('tbl1', tableDomain1);
      tables.addTable('tbl2', tableDomain2);
    });

    it('should track visited state', () => {
      expect(tables.isVisited('tbl1')).toBe(false);

      tables.markVisited('tbl1');

      expect(tables.isVisited('tbl1')).toBe(true);
      expect(tables.isVisited('tbl2')).toBe(false);
    });

    it('should get visited and unvisited tables', () => {
      tables.markVisited('tbl1');

      const visitedTables = tables.getVisitedTables();
      const unvisitedTables = tables.getUnvisitedTables();

      expect(visitedTables.size).toBe(1);
      expect(visitedTables.has('tbl1')).toBe(true);
      expect(unvisitedTables.size).toBe(1);
      expect(unvisitedTables.has('tbl2')).toBe(true);
    });

    it('should get visited table IDs', () => {
      tables.markVisited('tbl1');
      tables.markVisited('tbl2');

      const visitedIds = tables.getVisitedTableIds();

      expect(visitedIds).toHaveLength(2);
      expect(visitedIds).toContain('tbl1');
      expect(visitedIds).toContain('tbl2');
    });
  });

  describe('collection operations', () => {
    beforeEach(() => {
      tables.addTable('tbl1', tableDomain1);
      tables.addTable('tbl2', tableDomain2);
    });

    it('should get table IDs and domains', () => {
      const tableIds = tables.getTableIds();
      const tableDomains = tables.getTableDomainByIdsArray();

      expect(tableIds).toHaveLength(2);
      expect(tableIds).toContain('tbl1');
      expect(tableIds).toContain('tbl2');
      expect(tableDomains).toHaveLength(2);
      expect(tableDomains).toContain(tableDomain1);
      expect(tableDomains).toContain(tableDomain2);
    });

    it('should filter tables', () => {
      const filteredTables = tables.filterTables((domain, id) => id === 'tbl1');

      expect(filteredTables).toHaveLength(1);
      expect(filteredTables[0]).toBe(tableDomain1);
    });

    it('should map tables', () => {
      const tableNames = tables.mapTables((domain) => domain.name);

      expect(tableNames).toHaveLength(2);
      expect(tableNames).toContain('Table 1');
      expect(tableNames).toContain('Table 2');
    });

    it('should get all related table IDs', () => {
      const relatedTableIds = tables.getAllRelatedTableIds();

      expect(relatedTableIds.has('tbl2')).toBe(true); // tbl1 links to tbl2
    });

    it('should clear all tables and visited state', () => {
      tables.markVisited('tbl1');

      tables.clear();

      expect(tables.size).toBe(0);
      expect(tables.isEmpty).toBe(true);
      expect(tables.isVisited('tbl1')).toBe(false);
    });
  });

  describe('iteration and conversion', () => {
    beforeEach(() => {
      tables.addTable('tbl1', tableDomain1);
      tables.addTable('tbl2', tableDomain2);
    });

    it('should support iteration', () => {
      const entries = Array.from(tables);

      expect(entries).toHaveLength(2);
      expect(entries[0][0]).toBe('tbl1');
      expect(entries[0][1]).toBe(tableDomain1);
    });

    it('should convert to plain object', () => {
      tables.markVisited('tbl1');

      const plainObject = tables.toPlainObject();

      expect(plainObject.entryTableId).toBe('tbl1');
      expect(plainObject.size).toBe(2);
      expect(plainObject.isEmpty).toBe(false);
      expect(plainObject.visited).toContain('tbl1');
      expect(plainObject.tables).toHaveProperty('tbl1');
      expect(plainObject.tables).toHaveProperty('tbl2');
      expect(plainObject.foreignTables).toHaveProperty('tbl2');
      expect(plainObject.foreignTables).not.toHaveProperty('tbl1');
    });

    it('should clone tables', () => {
      tables.markVisited('tbl1');

      const clonedTables = tables.clone();

      expect(clonedTables.size).toBe(2);
      expect(clonedTables.isVisited('tbl1')).toBe(true);
      expect(clonedTables.hasTable('tbl1')).toBe(true);
      expect(clonedTables.hasTable('tbl2')).toBe(true);

      // Should be independent copies
      clonedTables.addTable('tbl3', tableDomain1);
      expect(tables.hasTable('tbl3')).toBe(false);
    });
  });
});
