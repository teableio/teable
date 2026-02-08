import type { Table, DomainError, Field } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import type { SchemaIntrospector } from '../context/SchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import { createSchemaRuleContext } from '../context/SchemaRuleContext';
import type { ISchemaRule } from '../core/ISchemaRule';
import { createFieldSchemaRules } from '../field/FieldSchemaRulesFactory';
import { schemaRuleResolver } from '../resolver/SchemaRuleResolver';
import {
  type SchemaCheckResult,
  pendingResult,
  runningResult,
  successResult,
  errorResult,
  warnResult,
} from './SchemaCheckResult';

/**
 * Parameters for creating a SchemaChecker.
 */
export interface SchemaCheckerParams {
  db: Kysely<V1TeableDatabase>;
  introspector: SchemaIntrospector;
  schema: string | null;
}

/**
 * Information about a field and its rules for checking.
 */
interface FieldCheckInfo {
  fieldId: string;
  fieldName: string;
  rules: ReadonlyArray<ISchemaRule>;
  ctx: SchemaRuleContext;
}

/**
 * Resolved table location (schema + table name).
 */
interface ResolvedTableLocation {
  schema: string | null;
  tableName: string;
}

/**
 * Resolve the DB table location from a Table, falling back to table ID.
 * DbTableName may contain "schema.table" format, so we use split() to parse it.
 */
const resolveDbTableLocation = (
  table: Table,
  defaultSchema: string | null
): ResolvedTableLocation => {
  const dbTableNameResult = table.dbTableName();
  if (dbTableNameResult.isErr()) {
    return { schema: defaultSchema, tableName: table.id().toString() };
  }

  const splitResult = dbTableNameResult.value.split({ defaultSchema });
  if (splitResult.isErr()) {
    return { schema: defaultSchema, tableName: table.id().toString() };
  }

  return splitResult.value;
};

/**
 * Calculate the depth of a rule based on its dependencies.
 * Rules with no dependencies have depth 0.
 * Rules with dependencies have depth = max(parent depths) + 1.
 */
const calculateRuleDepths = (rules: ReadonlyArray<ISchemaRule>): Map<string, number> => {
  const depths = new Map<string, number>();
  const ruleMap = new Map(rules.map((r) => [r.id, r]));

  const getDepth = (ruleId: string, visited: Set<string> = new Set()): number => {
    // Prevent infinite loops
    if (visited.has(ruleId)) return 0;
    visited.add(ruleId);

    // If already calculated, return cached value
    if (depths.has(ruleId)) {
      return depths.get(ruleId)!;
    }

    const rule = ruleMap.get(ruleId);
    if (!rule || rule.dependencies.length === 0) {
      depths.set(ruleId, 0);
      return 0;
    }

    // Calculate max depth of dependencies
    let maxParentDepth = -1;
    for (const depId of rule.dependencies) {
      const parentDepth = getDepth(depId, new Set(visited));
      if (parentDepth > maxParentDepth) {
        maxParentDepth = parentDepth;
      }
    }

    const depth = maxParentDepth + 1;
    depths.set(ruleId, depth);
    return depth;
  };

  // Calculate depth for all rules
  for (const rule of rules) {
    getDepth(rule.id);
  }

  return depths;
};

/**
 * Checks the schema of a table field by field, rule by rule.
 * Yields results as an async generator for streaming.
 */
export class SchemaChecker {
  constructor(private readonly params: SchemaCheckerParams) {}

  /**
   * Check all fields in a table.
   * Yields check results one by one for each rule.
   */
  async *checkTable(table: Table): AsyncGenerator<SchemaCheckResult, void, unknown> {
    const fields = table.getFields();
    const tableLocation = resolveDbTableLocation(table, this.params.schema);

    // First, collect all field check info
    const fieldChecks: FieldCheckInfo[] = [];
    const errors: Array<{ fieldId: string; fieldName: string; error: DomainError }> = [];

    for (const field of fields) {
      const fieldId = field.id().toString();
      const fieldName = field.name().toString();

      // Create rules for this field
      const rulesResult = createFieldSchemaRules(field, {
        schema: tableLocation.schema,
        tableName: tableLocation.tableName,
        tableId: table.id().toString(),
      });

      if (rulesResult.isErr()) {
        errors.push({ fieldId, fieldName, error: rulesResult.error });
        continue;
      }

      // Create context for this field
      const ctx = createSchemaRuleContext({
        db: this.params.db,
        introspector: this.params.introspector,
        schema: tableLocation.schema,
        tableName: tableLocation.tableName,
        tableId: table.id().toString(),
        field,
        table,
      });

      fieldChecks.push({
        fieldId,
        fieldName,
        rules: rulesResult.value,
        ctx,
      });
    }

    // Yield errors first
    for (const { fieldId, fieldName, error } of errors) {
      yield errorResult(
        pendingResult(fieldId, fieldName, 'rules_creation', 'Rules creation', true, [], 0),
        error.message
      );
    }

    // Now process each field's rules
    for (const { fieldId, fieldName, rules, ctx } of fieldChecks) {
      // Resolve rules to get the correct order
      const resolutionResult = schemaRuleResolver.resolve(rules);

      if (resolutionResult.isErr()) {
        yield errorResult(
          pendingResult(fieldId, fieldName, 'rules_resolution', 'Rules resolution', true, [], 0),
          resolutionResult.error.message
        );
        continue;
      }

      const orderedRules = resolutionResult.value.orderedRules;

      // Calculate depths for all rules
      const ruleDepths = calculateRuleDepths(orderedRules);

      // Track which rules have been validated (for dependency checking)
      const validatedRules = new Map<string, boolean>();

      // Check each rule in order
      for (const rule of orderedRules) {
        const depth = ruleDepths.get(rule.id) ?? 0;
        const pending = pendingResult(
          fieldId,
          fieldName,
          rule.id,
          rule.description,
          rule.required,
          rule.dependencies,
          depth
        );

        // Check dependencies first
        const dependenciesSatisfied = rule.dependencies.every((depId) => {
          const depResult = validatedRules.get(depId);
          return depResult === true;
        });

        if (!dependenciesSatisfied) {
          const missingDeps = rule.dependencies.filter((d) => validatedRules.get(d) !== true);
          if (rule.required) {
            // Skip this rule if dependencies failed
            yield errorResult(pending, 'Skipped: dependencies not satisfied', {
              missing: missingDeps,
            });
            validatedRules.set(rule.id, false);
          } else {
            yield warnResult(pending, 'Skipped: dependencies not satisfied', {
              missing: missingDeps,
            });
            validatedRules.set(rule.id, true);
          }
          continue;
        }

        // Yield running status
        yield runningResult(pending);

        // Perform the validation
        try {
          const validationResult = await rule.isValid(ctx);

          if (validationResult.isErr()) {
            yield errorResult(pending, validationResult.error.message);
            validatedRules.set(rule.id, false);
            continue;
          }

          const validation = validationResult.value;

          if (validation.valid) {
            yield successResult(pending);
            validatedRules.set(rule.id, true);
          } else {
            // For optional rules, yield warning; for required, yield error
            const details = {
              missing: validation.missing,
              extra: validation.extra,
            };

            if (rule.required) {
              yield errorResult(pending, 'Schema validation failed', details);
              validatedRules.set(rule.id, false);
            } else {
              yield warnResult(pending, 'Schema element missing', details);
              // Optional rules not blocking dependencies
              validatedRules.set(rule.id, true);
            }
          }
        } catch (e) {
          yield errorResult(
            pending,
            e instanceof Error ? e.message : 'Unknown error during validation'
          );
          validatedRules.set(rule.id, false);
        }
      }
    }
  }

  /**
   * Check a single field.
   * Yields check results one by one for each rule.
   */
  async *checkField(
    table: Table,
    fieldId: string
  ): AsyncGenerator<SchemaCheckResult, void, unknown> {
    const fields = table.getFields();
    const field = fields.find((f: Field) => f.id().toString() === fieldId);
    const tableLocation = resolveDbTableLocation(table, this.params.schema);

    if (!field) {
      yield errorResult(
        pendingResult(fieldId, 'Unknown', 'field_lookup', 'Field lookup', true, [], 0),
        `Field ${fieldId} not found in table`
      );
      return;
    }

    const fieldName = field.name().toString();

    // Create rules for this field
    const rulesResult = createFieldSchemaRules(field, {
      schema: tableLocation.schema,
      tableName: tableLocation.tableName,
      tableId: table.id().toString(),
    });

    if (rulesResult.isErr()) {
      yield errorResult(
        pendingResult(fieldId, fieldName, 'rules_creation', 'Rules creation', true, [], 0),
        rulesResult.error.message
      );
      return;
    }

    // Create context for this field
    const ctx = createSchemaRuleContext({
      db: this.params.db,
      introspector: this.params.introspector,
      schema: tableLocation.schema,
      tableName: tableLocation.tableName,
      tableId: table.id().toString(),
      field,
      table,
    });

    // Resolve rules
    const resolutionResult = schemaRuleResolver.resolve(rulesResult.value);

    if (resolutionResult.isErr()) {
      yield errorResult(
        pendingResult(fieldId, fieldName, 'rules_resolution', 'Rules resolution', true, [], 0),
        resolutionResult.error.message
      );
      return;
    }

    const orderedRules = resolutionResult.value.orderedRules;
    const ruleDepths = calculateRuleDepths(orderedRules);
    const validatedRules = new Map<string, boolean>();

    for (const rule of orderedRules) {
      const depth = ruleDepths.get(rule.id) ?? 0;
      const pending = pendingResult(
        fieldId,
        fieldName,
        rule.id,
        rule.description,
        rule.required,
        rule.dependencies,
        depth
      );

      // Check dependencies
      const dependenciesSatisfied = rule.dependencies.every((depId) => {
        return validatedRules.get(depId) === true;
      });

      if (!dependenciesSatisfied) {
        if (rule.required) {
          yield errorResult(pending, 'Skipped: dependencies not satisfied');
          validatedRules.set(rule.id, false);
        } else {
          yield warnResult(pending, 'Skipped: dependencies not satisfied');
          validatedRules.set(rule.id, true);
        }
        continue;
      }

      yield runningResult(pending);

      try {
        const validationResult = await rule.isValid(ctx);

        if (validationResult.isErr()) {
          yield errorResult(pending, validationResult.error.message);
          validatedRules.set(rule.id, false);
          continue;
        }

        const validation = validationResult.value;

        if (validation.valid) {
          yield successResult(pending);
          validatedRules.set(rule.id, true);
        } else {
          const details = { missing: validation.missing, extra: validation.extra };

          if (rule.required) {
            yield errorResult(
              pending,
              `Schema validation failed: ${validation.missing?.join(', ') || 'unknown issue'}`,
              details
            );
            validatedRules.set(rule.id, false);
          } else {
            yield warnResult(
              pending,
              `Optional schema element missing: ${validation.missing?.join(', ')}`,
              details
            );
            validatedRules.set(rule.id, true);
          }
        }
      } catch (e) {
        yield errorResult(
          pending,
          e instanceof Error ? e.message : 'Unknown error during validation'
        );
        validatedRules.set(rule.id, false);
      }
    }
  }
}

/**
 * Create a schema checker instance.
 */
export const createSchemaChecker = (params: SchemaCheckerParams): SchemaChecker => {
  return new SchemaChecker(params);
};
