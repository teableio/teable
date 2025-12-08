import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Knex } from 'knex';
import { GlobalModule } from '../../global/global.module';
import { BaseNodeModule } from './base-node.module';
import { BaseNodeService } from './base-node.service';
import { buildBatchUpdateSql } from './helper';

describe('BaseNodeService', () => {
  let service: BaseNodeService;
  let knex: Knex;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, BaseNodeModule],
    }).compile();

    service = module.get<BaseNodeService>(BaseNodeService);
    knex = module.get<Knex>('CUSTOM_KNEX');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildBatchUpdateSql', () => {
    it('should return null for empty data', () => {
      const result = buildBatchUpdateSql(knex, []);
      expect(result).toBeNull();
    });

    it('should return null for data with empty values', () => {
      const result = buildBatchUpdateSql(knex, [{ id: 'node1', values: {} }]);
      expect(result).toBeNull();
    });

    it('should build SQL for single record with single field', () => {
      const result = buildBatchUpdateSql(knex, [{ id: 'node1', values: { order: 1 } }]);

      expect(result).not.toBeNull();
      expect(result).toContain('update "base_node"');
      expect(result).toContain('"order"');
      expect(result).toContain(`CASE WHEN "id" = 'node1' THEN 1 ELSE "order" END`);
      expect(result).toContain(`where "id" in ('node1')`);
    });

    it('should build SQL for single record with multiple fields', () => {
      const result = buildBatchUpdateSql(knex, [
        { id: 'node1', values: { parentId: null, order: 5 } },
      ]);

      expect(result).not.toBeNull();
      expect(result).toContain('"parent_id"'); // camelCase -> snake_case
      expect(result).toContain('"order"');
      expect(result).toContain(`CASE WHEN "id" = 'node1' THEN NULL ELSE "parent_id" END`);
      expect(result).toContain(`CASE WHEN "id" = 'node1' THEN 5 ELSE "order" END`);
    });

    it('should build SQL for multiple records with same fields', () => {
      const result = buildBatchUpdateSql(knex, [
        { id: 'node1', values: { order: 1 } },
        { id: 'node2', values: { order: 2 } },
        { id: 'node3', values: { order: 3 } },
      ]);

      expect(result).not.toBeNull();
      // Should have multiple WHEN clauses in single CASE
      expect(result).toContain(`WHEN "id" = 'node1' THEN 1`);
      expect(result).toContain(`WHEN "id" = 'node2' THEN 2`);
      expect(result).toContain(`WHEN "id" = 'node3' THEN 3`);
      expect(result).toContain(`where "id" in ('node1', 'node2', 'node3')`);
    });

    it('should build SQL for multiple records with different fields', () => {
      const result = buildBatchUpdateSql(knex, [
        { id: 'node1', values: { parentId: 'folder1', order: 1 } },
        { id: 'node2', values: { order: 2 } }, // only order
        { id: 'node3', values: { parentId: null } }, // only parentId
      ]);

      expect(result).not.toBeNull();
      // parentId CASE should have node1 and node3
      expect(result).toMatch(/CASE.*node1.*node3.*parent_id.*END/s);
      // order CASE should have node1 and node2
      expect(result).toMatch(/CASE.*node1.*node2.*order.*END/s);
      // All ids in WHERE clause
      expect(result).toContain(`where "id" in ('node1', 'node2', 'node3')`);
    });

    it('should handle string values correctly', () => {
      const result = buildBatchUpdateSql(knex, [
        { id: 'node1', values: { resourceType: 'table' } },
      ]);

      expect(result).not.toBeNull();
      expect(result).toContain('"resource_type"');
      expect(result).toContain("'table'");
    });

    it('should convert camelCase keys to snake_case columns', () => {
      const result = buildBatchUpdateSql(knex, [
        { id: 'node1', values: { parentId: 'p1', resourceType: 'dashboard', createdBy: 'user1' } },
      ]);

      expect(result).not.toBeNull();
      expect(result).toContain('"parent_id"');
      expect(result).toContain('"resource_type"');
      expect(result).toContain('"created_by"');
      // Should not contain camelCase versions (without quotes)
      expect(result).not.toMatch(/[^"]parentId[^"]/);
      expect(result).not.toMatch(/[^"]resourceType[^"]/);
      expect(result).not.toMatch(/[^"]createdBy[^"]/);
    });

    it('should build complete SQL for multiple records with multiple fields', () => {
      const result = buildBatchUpdateSql(knex, [
        { id: 'bnod001', values: { parentId: null, order: 10 } },
        { id: 'bnod002', values: { parentId: 'folder1', order: 20 } },
        { id: 'bnod003', values: { parentId: 'folder2', order: 30 } },
      ]);

      expect(result).not.toBeNull();

      // Verify complete SQL structure
      const expectedSql =
        'update "base_node" set ' +
        `"parent_id" = CASE WHEN "id" = 'bnod001' THEN NULL WHEN "id" = 'bnod002' THEN 'folder1' WHEN "id" = 'bnod003' THEN 'folder2' ELSE "parent_id" END, ` +
        `"order" = CASE WHEN "id" = 'bnod001' THEN 10 WHEN "id" = 'bnod002' THEN 20 WHEN "id" = 'bnod003' THEN 30 ELSE "order" END ` +
        `where "id" in ('bnod001', 'bnod002', 'bnod003')`;

      expect(result).toBe(expectedSql);
    });
  });
});
