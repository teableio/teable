import type { Table } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';

import type { SchemaIntrospector } from '../context/SchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import { createSchemaRuleContext } from '../context/SchemaRuleContext';
import type { ISchemaRule } from '../core/ISchemaRule';
import { createFieldSchemaRules } from '../field/FieldSchemaRulesFactory';
import { schemaRuleResolver } from '../resolver/SchemaRuleResolver';
import {
  createSystemTableRules,
  SYSTEM_RULE_FIELD_ID,
  SYSTEM_RULE_FIELD_NAME,
} from '../table/SystemTableRules';

export interface SchemaRulePlannerParams {
  db: Kysely<V1TeableDatabase>;
  introspector: SchemaIntrospector;
  schema: string | null;
}

export interface SchemaRuleTarget {
  fieldId?: string;
  ruleId?: string;
}

export type SchemaRulePlanningStage =
  | 'field_lookup'
  | 'rule_lookup'
  | 'rules_creation'
  | 'rules_resolution';

export interface SchemaRulePlanError {
  readonly type: 'error';
  readonly fieldId: string;
  readonly fieldName: string;
  readonly stage: SchemaRulePlanningStage;
  readonly message: string;
}

export interface SchemaRuleFieldPlan {
  readonly type: 'plan';
  readonly fieldId: string;
  readonly fieldName: string;
  readonly ctx: SchemaRuleContext;
  readonly orderedRules: ReadonlyArray<ISchemaRule>;
  readonly selectedRules: ReadonlyArray<ISchemaRule>;
  readonly ruleDepths: ReadonlyMap<string, number>;
}

export type SchemaRulePlanEntry = SchemaRulePlanError | SchemaRuleFieldPlan;

interface ResolvedTableLocation {
  schema: string | null;
  tableName: string;
}

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

export const calculateRuleDepths = (rules: ReadonlyArray<ISchemaRule>): Map<string, number> => {
  const depths = new Map<string, number>();
  const ruleMap = new Map(rules.map((r) => [r.id, r]));

  const getDepth = (ruleId: string, visited: Set<string> = new Set()): number => {
    if (visited.has(ruleId)) return 0;
    visited.add(ruleId);

    const cached = depths.get(ruleId);
    if (cached != null) {
      return cached;
    }

    const rule = ruleMap.get(ruleId);
    if (!rule || rule.dependencies.length === 0) {
      depths.set(ruleId, 0);
      return 0;
    }

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

  for (const rule of rules) {
    getDepth(rule.id);
  }

  return depths;
};

export const getSchemaRulePlanningStageDescription = (stage: SchemaRulePlanningStage): string => {
  switch (stage) {
    case 'field_lookup':
      return 'Field lookup';
    case 'rule_lookup':
      return 'Rule lookup';
    case 'rules_creation':
      return 'Rules creation';
    case 'rules_resolution':
      return 'Rules resolution';
  }
};

const collectDependencyClosure = (
  ruleId: string,
  ruleMap: ReadonlyMap<string, ISchemaRule>,
  collected: Set<string> = new Set()
): Set<string> => {
  if (collected.has(ruleId)) {
    return collected;
  }

  collected.add(ruleId);
  const rule = ruleMap.get(ruleId);
  if (!rule) {
    return collected;
  }

  for (const dependency of rule.dependencies) {
    if (ruleMap.has(dependency)) {
      collectDependencyClosure(dependency, ruleMap, collected);
    }
  }

  return collected;
};

const createPlanEntry = (params: {
  fieldId: string;
  fieldName: string;
  ctx: SchemaRuleContext;
  rules: ReadonlyArray<ISchemaRule>;
  target: SchemaRuleTarget;
}): SchemaRulePlanEntry => {
  const orderedRules = params.rules;
  let selectedRules = orderedRules;

  if (params.target.ruleId != null) {
    const ruleMap = new Map(orderedRules.map((rule) => [rule.id, rule]));
    if (!ruleMap.has(params.target.ruleId)) {
      return {
        type: 'error',
        fieldId: params.fieldId,
        fieldName: params.fieldName,
        stage: 'rule_lookup',
        message: `Rule ${params.target.ruleId} not found for field ${params.fieldId}`,
      };
    }

    const dependencyClosure = collectDependencyClosure(params.target.ruleId, ruleMap);
    selectedRules = orderedRules.filter((rule) => dependencyClosure.has(rule.id));
  }

  return {
    type: 'plan',
    fieldId: params.fieldId,
    fieldName: params.fieldName,
    ctx: params.ctx,
    orderedRules,
    selectedRules,
    ruleDepths: calculateRuleDepths(orderedRules),
  };
};

export class SchemaRulePlanner {
  constructor(private readonly params: SchemaRulePlannerParams) {}

  planTable(table: Table, target: SchemaRuleTarget = {}): ReadonlyArray<SchemaRulePlanEntry> {
    const tableLocation = resolveDbTableLocation(table, this.params.schema);
    const allFields = table.getFields();

    if (target.ruleId && !target.fieldId) {
      return [
        {
          type: 'error',
          fieldId: '',
          fieldName: 'Unknown',
          stage: 'rule_lookup',
          message: 'ruleId targeting requires fieldId',
        },
      ];
    }

    const fields =
      target.fieldId != null
        ? target.fieldId === SYSTEM_RULE_FIELD_ID
          ? []
          : allFields.filter((field) => field.id().toString() === target.fieldId)
        : allFields;

    if (target.fieldId != null && target.fieldId !== SYSTEM_RULE_FIELD_ID && fields.length === 0) {
      return [
        {
          type: 'error',
          fieldId: target.fieldId,
          fieldName: 'Unknown',
          stage: 'field_lookup',
          message: `Field ${target.fieldId} not found in table`,
        },
      ];
    }

    const entries: SchemaRulePlanEntry[] = [];

    if (target.fieldId == null || target.fieldId === SYSTEM_RULE_FIELD_ID) {
      const systemRules = createSystemTableRules();
      const systemResolutionResult = schemaRuleResolver.resolve(systemRules);
      if (systemResolutionResult.isErr()) {
        entries.push({
          type: 'error',
          fieldId: SYSTEM_RULE_FIELD_ID,
          fieldName: SYSTEM_RULE_FIELD_NAME,
          stage: 'rules_resolution',
          message: systemResolutionResult.error.message,
        });
      } else {
        const systemCtx = createSchemaRuleContext({
          db: this.params.db,
          introspector: this.params.introspector,
          schema: tableLocation.schema,
          tableName: tableLocation.tableName,
          tableId: table.id().toString(),
          table,
        });

        entries.push(
          createPlanEntry({
            fieldId: SYSTEM_RULE_FIELD_ID,
            fieldName: SYSTEM_RULE_FIELD_NAME,
            ctx: systemCtx,
            rules: systemResolutionResult.value.orderedRules,
            target,
          })
        );
      }
    }

    for (const field of fields) {
      const fieldId = field.id().toString();
      const fieldName = field.name().toString();

      const rulesResult = createFieldSchemaRules(field, {
        schema: tableLocation.schema,
        tableName: tableLocation.tableName,
        tableId: table.id().toString(),
      });

      if (rulesResult.isErr()) {
        entries.push({
          type: 'error',
          fieldId,
          fieldName,
          stage: 'rules_creation',
          message: rulesResult.error.message,
        });
        continue;
      }

      const ctx = createSchemaRuleContext({
        db: this.params.db,
        introspector: this.params.introspector,
        schema: tableLocation.schema,
        tableName: tableLocation.tableName,
        tableId: table.id().toString(),
        field,
        table,
      });

      const resolutionResult = schemaRuleResolver.resolve(rulesResult.value);
      if (resolutionResult.isErr()) {
        entries.push({
          type: 'error',
          fieldId,
          fieldName,
          stage: 'rules_resolution',
          message: resolutionResult.error.message,
        });
        continue;
      }

      entries.push(
        createPlanEntry({
          fieldId,
          fieldName,
          ctx,
          rules: resolutionResult.value.orderedRules,
          target,
        })
      );
    }

    return entries;
  }
}

export const createSchemaRulePlanner = (params: SchemaRulePlannerParams): SchemaRulePlanner =>
  new SchemaRulePlanner(params);
