import { domainError, type DomainError } from '@teable/v2-core';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';

/**
 * Result of resolving rule dependencies into execution order.
 */
export interface RuleResolutionResult {
  /** Rules sorted in dependency order (dependencies come first) */
  orderedRules: ReadonlyArray<ISchemaRule>;
}

/**
 * Interface for resolving and executing schema rules.
 */
export interface ISchemaRuleResolver {
  /**
   * Topologically sorts rules ensuring dependencies come before dependents.
   * Detects circular dependencies.
   */
  resolve(rules: ReadonlyArray<ISchemaRule>): Result<RuleResolutionResult, DomainError>;

  /**
   * Validates all rules against the current database state.
   * Returns a map of rule ID to validation result.
   */
  validateAll(
    rules: ReadonlyArray<ISchemaRule>,
    ctx: SchemaRuleContext
  ): Promise<Result<Map<string, SchemaRuleValidationResult>, DomainError>>;

  /**
   * Generates all UP statements in dependency order.
   */
  upAll(
    rules: ReadonlyArray<ISchemaRule>,
    ctx: SchemaRuleContext
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;

  /**
   * Generates all DOWN statements in reverse dependency order.
   */
  downAll(
    rules: ReadonlyArray<ISchemaRule>,
    ctx: SchemaRuleContext
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;
}

/**
 * Default implementation of ISchemaRuleResolver.
 * Uses Kahn's algorithm for topological sorting.
 */
export class SchemaRuleResolver implements ISchemaRuleResolver {
  resolve(rules: ReadonlyArray<ISchemaRule>): Result<RuleResolutionResult, DomainError> {
    if (rules.length === 0) {
      return ok({ orderedRules: [] });
    }

    // Build adjacency list and in-degree map
    const ruleMap = new Map<string, ISchemaRule>();
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    for (const rule of rules) {
      ruleMap.set(rule.id, rule);
      inDegree.set(rule.id, 0);
      graph.set(rule.id, []);
    }

    // Build edges: dependency -> dependent
    for (const rule of rules) {
      for (const depId of rule.dependencies) {
        // Only consider dependencies that are in the current rule set
        if (ruleMap.has(depId)) {
          graph.get(depId)!.push(rule.id);
          inDegree.set(rule.id, (inDegree.get(rule.id) ?? 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    const sorted: ISchemaRule[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const rule = ruleMap.get(current);
      if (rule) {
        sorted.push(rule);
      }

      for (const neighbor of graph.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Check for cycles
    if (sorted.length !== rules.length) {
      const remaining = rules.filter((r) => !sorted.includes(r)).map((r) => r.id);
      return err(
        domainError.invariant({
          message: `Circular dependency detected among rules: ${remaining.join(', ')}`,
          code: 'schema.rule.circular_dependency',
          details: { remainingRules: remaining },
        })
      );
    }

    return ok({ orderedRules: sorted });
  }

  async validateAll(
    rules: ReadonlyArray<ISchemaRule>,
    ctx: SchemaRuleContext
  ): Promise<Result<Map<string, SchemaRuleValidationResult>, DomainError>> {
    const resolver = this;
    return safeTry<Map<string, SchemaRuleValidationResult>, DomainError>(async function* () {
      const resolution = yield* resolver.resolve(rules);
      const results = new Map<string, SchemaRuleValidationResult>();

      for (const rule of resolution.orderedRules) {
        const result = yield* await rule.isValid(ctx);
        results.set(rule.id, result);
      }

      return ok(results);
    });
  }

  upAll(
    rules: ReadonlyArray<ISchemaRule>,
    ctx: SchemaRuleContext
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const resolver = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const resolution = yield* resolver.resolve(rules);
      const statements: TableSchemaStatementBuilder[] = [];

      for (const rule of resolution.orderedRules) {
        const ruleStatements = yield* rule.up(ctx);
        statements.push(...ruleStatements);
      }

      return ok(statements);
    });
  }

  downAll(
    rules: ReadonlyArray<ISchemaRule>,
    ctx: SchemaRuleContext
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const resolver = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const resolution = yield* resolver.resolve(rules);
      // Reverse order for dropping
      const reversedRules = [...resolution.orderedRules].reverse();
      const statements: TableSchemaStatementBuilder[] = [];

      for (const rule of reversedRules) {
        const ruleStatements = yield* rule.down(ctx);
        statements.push(...ruleStatements);
      }

      return ok(statements);
    });
  }
}

/** Singleton resolver instance */
export const schemaRuleResolver = new SchemaRuleResolver();
