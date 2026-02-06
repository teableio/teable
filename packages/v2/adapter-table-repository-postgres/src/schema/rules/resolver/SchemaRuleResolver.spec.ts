import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type { ISchemaRule, TableSchemaStatementBuilder } from '../core/ISchemaRule';
import { SchemaRuleResolver } from './SchemaRuleResolver';

// Mock rule for testing
const createMockRule = (id: string, dependencies: string[] = [], required = true): ISchemaRule => ({
  id,
  description: `Mock rule ${id}`,
  dependencies,
  required,
  isValid: async () => ok({ valid: true }),
  up: () =>
    ok([
      { compile: () => ({ sql: `UP ${id}`, parameters: [] }) },
    ] as unknown as TableSchemaStatementBuilder[]),
  down: () =>
    ok([
      { compile: () => ({ sql: `DOWN ${id}`, parameters: [] }) },
    ] as unknown as TableSchemaStatementBuilder[]),
});

describe('SchemaRuleResolver', () => {
  const resolver = new SchemaRuleResolver();

  describe('resolve', () => {
    it('should return empty array for empty input', () => {
      const result = resolver.resolve([]);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().orderedRules).toEqual([]);
    });

    it('should return rules in order when no dependencies', () => {
      const rules = [createMockRule('a'), createMockRule('b'), createMockRule('c')];
      const result = resolver.resolve(rules);

      expect(result.isOk()).toBe(true);
      const ordered = result._unsafeUnwrap().orderedRules;
      expect(ordered.length).toBe(3);
      expect(ordered.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('should order rules respecting dependencies', () => {
      const rules = [createMockRule('c', ['b']), createMockRule('a'), createMockRule('b', ['a'])];
      const result = resolver.resolve(rules);

      expect(result.isOk()).toBe(true);
      const ordered = result._unsafeUnwrap().orderedRules;
      expect(ordered.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('should handle complex dependency graph', () => {
      // a -> b -> c
      //   -> d
      const rules = [
        createMockRule('d', ['a']),
        createMockRule('c', ['b']),
        createMockRule('b', ['a']),
        createMockRule('a'),
      ];
      const result = resolver.resolve(rules);

      expect(result.isOk()).toBe(true);
      const ordered = result._unsafeUnwrap().orderedRules;
      expect(ordered[0].id).toBe('a');
      // b and d can be in either order since they both depend only on a
      expect(['b', 'd']).toContain(ordered[1].id);
      expect(['b', 'd']).toContain(ordered[2].id);
      expect(ordered[3].id).toBe('c');
    });

    it('should detect circular dependencies', () => {
      const rules = [
        createMockRule('a', ['c']),
        createMockRule('b', ['a']),
        createMockRule('c', ['b']),
      ];
      const result = resolver.resolve(rules);

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.message).toContain('Circular dependency');
    });

    it('should ignore dependencies not in the rule set', () => {
      const rules = [createMockRule('a', ['external']), createMockRule('b', ['a'])];
      const result = resolver.resolve(rules);

      expect(result.isOk()).toBe(true);
      const ordered = result._unsafeUnwrap().orderedRules;
      expect(ordered.map((r) => r.id)).toEqual(['a', 'b']);
    });
  });

  describe('upAll', () => {
    it('should generate UP statements in dependency order', () => {
      const rules = [createMockRule('c', ['b']), createMockRule('a'), createMockRule('b', ['a'])];
      const mockContext = {} as SchemaRuleContext;
      const result = resolver.upAll(rules, mockContext);

      expect(result.isOk()).toBe(true);
      const statements = result._unsafeUnwrap();
      expect(statements.length).toBe(3);
    });
  });

  describe('downAll', () => {
    it('should generate DOWN statements in reverse dependency order', () => {
      const rules = [createMockRule('a'), createMockRule('b', ['a']), createMockRule('c', ['b'])];
      const mockContext = {} as SchemaRuleContext;
      const result = resolver.downAll(rules, mockContext);

      expect(result.isOk()).toBe(true);
      const statements = result._unsafeUnwrap();
      expect(statements.length).toBe(3);
    });
  });
});
