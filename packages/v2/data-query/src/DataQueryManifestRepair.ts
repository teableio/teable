// oxlint-disable sonarjs/cognitive-complexity -- one branch per manifest node, projection kind and usage source

import { isRecordFilterFieldReferenceValue } from '@teable/v2-core';
import { stringify as stringifyYaml } from 'yaml';

import { collectDataQuerySourceFieldUsages } from './DataQueryFieldUsage';
import type { DataQueryManifest } from './DataQueryManifest';
import type {
  DataQueryDefinitionInput,
  DataQueryFilter,
  DataQueryRecordsProjection,
  DataQueryRelation,
  DataQuerySort,
} from './types';

/**
 * One schema change a repair plan is computed for. `baseId` is host scope and
 * deliberately absent: the planner is a pure function of the manifest and the
 * change, so it runs in tests and inside a worker without a database.
 *
 * `fieldName`/`previousName` are the only way a fallback SQL statement can be
 * correlated with a change. SQL text is never parsed or rewritten: when the
 * name is known and appears in the statement, the query needs a human.
 */
export type DataQuerySchemaChange =
  | {
      kind: 'field_deleted';
      tableId: string;
      fieldId: string;
      /** Deleted field name, when the host could still resolve it. */
      fieldName?: string;
    }
  | {
      kind: 'table_deleted';
      tableId: string;
      /** Best-effort identity used only for reporting; never required. */
      fieldIds?: readonly string[];
    }
  | {
      kind: 'field_updated';
      tableId: string;
      fieldId: string;
      /** Current (post-change) name, when known. */
      fieldName?: string;
      /** Name before a rename; SQL compares against it. */
      previousName?: string;
      /** The field's type changed. */
      typeChanged?: boolean;
      /**
       * Host assertion that the new type keeps the same wire output. Only then
       * is a type change a no-op; unknown means a human decides.
       */
      outputCompatible?: boolean;
    }
  | {
      kind: 'field_replaced';
      tableId: string;
      /** Field id the accepted manifest still references. */
      fieldId: string;
      /** Unique replacement. Absent means the mapping is ambiguous. */
      replacementFieldId?: string;
      /** Name before a rename, for fallback correlation. */
      previousName?: string;
      /** Replacement keeps the projected output shape. */
      outputCompatible?: boolean;
    };

export type DataQueryRepairClassification = 'auto' | 'manual' | 'noop';

export type DataQueryRepairReason =
  | 'field_deleted_projection'
  | 'field_deleted_sort'
  | 'filter_semantics_changed'
  | 'group_semantics_changed'
  | 'field_deleted_aggregate'
  | 'relation_removed'
  | 'field_reference_rewritten'
  | 'switch_to_fallback'
  | 'fallback_references_field'
  | 'sql_query_unverifiable'
  | 'type_change_affects_output'
  | 'ambiguous_field_mapping'
  | 'table_deleted'
  | 'definition_empty';

export type DataQueryRepairAction =
  | { kind: 'remove_projection'; alias: string }
  | { kind: 'remove_sort'; index: number; alias?: string }
  | { kind: 'remove_filter'; source: string }
  | { kind: 'remove_group_by'; alias: string }
  | { kind: 'remove_aggregate'; alias: string }
  | { kind: 'remove_relation'; alias: string }
  | { kind: 'trim_sort_allow_list'; index: number }
  | { kind: 'remove_fallback_output'; alias: string }
  | {
      kind: 'rewrite_field';
      fromFieldId: string;
      toFieldId: string;
      usages: readonly string[];
    }
  | { kind: 'switch_to_fallback' };

export type DataQueryRepairQueryPlan = {
  queryId: string;
  classification: DataQueryRepairClassification;
  reasons: readonly DataQueryRepairReason[];
  actions: readonly DataQueryRepairAction[];
};

export type DataQueryRepairSummary = {
  /** Affected queries with an automatic rewrite. */
  auto: number;
  /** Affected queries a human must decide on. */
  manual: number;
  /** Queries the change does not reach. */
  noop: number;
};

export type DataQueryManifestRepairPlan = {
  change: DataQuerySchemaChange;
  queries: readonly DataQueryRepairQueryPlan[];
  summary: DataQueryRepairSummary;
  /** True only when every affected query is repairable (or untouched). */
  applyable: boolean;
  /** Query ids that block apply. */
  blockingQueryIds: readonly string[];
  /**
   * Manifest with every automatic rewrite applied. Present only when
   * `applyable`: a partially repaired manifest would fail the canonical save
   * gate because of the queries left untouched.
   */
  repaired?: DataQueryManifest;
  /**
   * Automatic rewrites even when other queries block apply. Preview only, and
   * never written; `diffDataQueryManifestRepair` reads it.
   */
  preview?: DataQueryManifest;
};

export type DataQueryManifestPatch = {
  path: string;
  before?: unknown;
  after?: unknown;
};

export type DataQueryManifestRepairDiff = {
  queries: ReadonlyArray<{
    queryId: string;
    classification: DataQueryRepairClassification;
    reasons: readonly DataQueryRepairReason[];
    actions: readonly DataQueryRepairAction[];
    patches: readonly DataQueryManifestPatch[];
  }>;
};

type MutableQuery = DataQueryManifest['queries'][string];
type MutableDefinition = DataQueryDefinitionInput;

type ChangeTarget = {
  tableId: string;
  fieldId?: string;
  replacementFieldId?: string;
  /** Identifier an existing SQL statement would use for the field. */
  sqlIdentifier?: string;
  typeChanged?: boolean;
  outputCompatible?: boolean;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Conservative SQL correlation. A field name is user text, so the only stable
 * forms are a quoted identifier or a bare token. Names with spaces only match
 * when quoted. The check never rewrites SQL; it only decides `manual`.
 */
export const sqlMentionsIdentifier = (sql: string, identifier: string | undefined): boolean => {
  if (!identifier) return false;
  if (sql.includes(`"${identifier.replace(/"/g, '""')}"`)) return true;
  if (/\s/.test(identifier)) return false;
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(identifier)}([^A-Za-z0-9_]|$)`).test(sql);
};

const sourceOf = (item: object): string =>
  'source' in item && typeof item.source === 'string' ? item.source : 'root';

type Relations = NonNullable<Extract<MutableDefinition, { version: 2 }>['relations']>;

/** `relations` only exists on version 2; callers must not cast the definition. */
const relationsOf = (definition: MutableDefinition): Relations =>
  definition.version === 2
    ? ((definition as Extract<MutableDefinition, { version: 2 }>).relations ?? {})
    : {};

const tableOfSource = (definition: MutableDefinition, source: string): string | undefined =>
  source === 'root' ? definition.tableId : relationsOf(definition)[source]?.tableId;

const linkHostTable = (
  definition: MutableDefinition,
  relation: DataQueryRelation
): string | undefined =>
  relation.via ? tableOfSource(definition, relation.via) : definition.tableId;

const actionsOf = (reasons: Set<DataQueryRepairReason>, actions: DataQueryRepairAction[]) => ({
  add: (action: DataQueryRepairAction, reason: DataQueryRepairReason) => {
    actions.push(action);
    reasons.add(reason);
  },
});

/** Drop the fallback output entries whose aliases no longer exist. */
const pruneFallbackOutputs = (
  query: MutableQuery,
  removedAliases: ReadonlySet<string>,
  actions: DataQueryRepairAction[]
) => {
  const outputs = query.fallback?.outputs;
  if (!outputs?.length || removedAliases.size === 0) return;
  const kept = outputs.filter((output) => !removedAliases.has(output.alias));
  if (kept.length === outputs.length) return;
  for (const output of outputs) {
    if (removedAliases.has(output.alias)) {
      actions.push({ kind: 'remove_fallback_output', alias: output.alias });
    }
  }
  if (kept.length) {
    query.fallback!.outputs = kept;
  } else if (query.definition) {
    // A definition-backed fallback may omit outputs; SQL-only cannot.
    delete query.fallback!.outputs;
  }
};

const leafTouchesField = (
  leaf: Extract<DataQueryFilter, { fieldId: string }>,
  definition: MutableDefinition,
  source: string,
  target: ChangeTarget
): boolean => {
  const tableId = tableOfSource(definition, source);
  if (tableId === target.tableId && leaf.fieldId === target.fieldId) return true;
  const value = leaf.value;
  if (!isRecordFilterFieldReferenceValue(value)) return false;
  const qualified = value.tableId ?? tableId;
  return qualified === target.tableId && value.fieldId === target.fieldId;
};

type FilterRemoval = { node?: DataQueryFilter; removed: number };

/** Remove leaves that read the changed field; unwrap emptied groups and `not`. */
const removeFilterLeaves = (
  node: DataQueryFilter,
  definition: MutableDefinition,
  source: string,
  target: ChangeTarget
): FilterRemoval => {
  if ('items' in node) {
    const children = node.items.map((item) => removeFilterLeaves(item, definition, source, target));
    const removed = children.reduce((count, child) => count + child.removed, 0);
    if (!removed) return { node, removed: 0 };
    const items = children.flatMap((child) => (child.node ? [child.node] : []));
    return items.length ? { node: { conjunction: node.conjunction, items }, removed } : { removed };
  }
  if ('not' in node) {
    const inner = removeFilterLeaves(node.not, definition, source, target);
    if (!inner.removed) return { node, removed: 0 };
    return inner.node
      ? { node: { not: inner.node }, removed: inner.removed }
      : { removed: inner.removed };
  }
  return leafTouchesField(node, definition, source, target) ? { removed: 1 } : { node, removed: 0 };
};

/**
 * Rewrite every reference to one field id inside its own table scope. Returns
 * the usage kinds that were touched.
 */
const rewriteFieldReferences = (
  definition: MutableDefinition,
  target: ChangeTarget,
  toFieldId: string,
  usages: Set<string>
): void => {
  const rewrite = (tableId: string | undefined, fieldId: string): string => {
    if (tableId !== target.tableId || fieldId !== target.fieldId) return fieldId;
    return toFieldId;
  };

  for (const relation of Object.values(relationsOf(definition))) {
    if (linkHostTable(definition, relation) !== target.tableId) continue;
    if (relation.linkFieldId !== target.fieldId) continue;
    relation.linkFieldId = toFieldId;
    usages.add('relation');
  }

  if (definition.kind === 'records') {
    for (const projection of definition.select) {
      if (!('fieldId' in projection) || typeof projection.fieldId !== 'string') continue;
      const before = projection.fieldId;
      projection.fieldId = rewrite(tableOfSource(definition, sourceOf(projection)), before);
      if (projection.fieldId !== before) {
        usages.add('statisticFunc' in projection ? 'aggregate' : 'projection');
      }
    }
  } else {
    for (const aggregate of definition.aggregates) {
      // A relation `count` metric carries no fieldId, so there is nothing to rewrite.
      if (typeof aggregate.fieldId !== 'string') continue;
      const before = aggregate.fieldId;
      aggregate.fieldId = rewrite(tableOfSource(definition, sourceOf(aggregate)), before);
      if (aggregate.fieldId !== before) usages.add('aggregate');
    }
    for (const group of definition.groupBy ?? []) {
      const before = group.fieldId;
      group.fieldId = rewrite(tableOfSource(definition, sourceOf(group)), before);
      if (group.fieldId !== before) usages.add('group');
    }
  }

  definition.sort = definition.sort?.map((item): DataQuerySort => {
    if ('fieldId' in item) {
      const before = item.fieldId;
      item.fieldId = rewrite(tableOfSource(definition, sourceOf(item)), before);
      if (item.fieldId !== before) usages.add('sort');
      return item;
    }
    if (!('allowed' in item)) return item;
    const allowed = item.allowed.map((allowedTarget) => {
      if (!('fieldId' in allowedTarget)) return allowedTarget;
      const before = allowedTarget.fieldId;
      const fieldId = rewrite(tableOfSource(definition, sourceOf(allowedTarget)), before);
      if (fieldId !== before) usages.add('sort');
      return { ...allowedTarget, fieldId };
    });
    return { ...item, allowed };
  });

  const rewriteFilter = (node: DataQueryFilter, source: string): DataQueryFilter => {
    if ('items' in node) {
      return { ...node, items: node.items.map((item) => rewriteFilter(item, source)) };
    }
    if ('not' in node) return { not: rewriteFilter(node.not, source) };
    const tableId = tableOfSource(definition, source);
    const fieldId = rewrite(tableId, node.fieldId);
    if (fieldId !== node.fieldId) usages.add('filter');
    const value = node.value;
    if (!isRecordFilterFieldReferenceValue(value)) {
      return fieldId === node.fieldId ? node : { ...node, fieldId };
    }
    const rewritten = rewrite(value.tableId ?? tableId, value.fieldId);
    if (rewritten === value.fieldId) {
      return fieldId === node.fieldId ? node : { ...node, fieldId };
    }
    usages.add('reference');
    return { ...node, fieldId, value: { ...value, fieldId: rewritten } };
  };

  if (definition.filter) definition.filter = rewriteFilter(definition.filter, 'root');
  for (const [alias, relation] of Object.entries(relationsOf(definition))) {
    if (relation.filter) relation.filter = rewriteFilter(relation.filter, alias);
  }
};

/** `mode: auto` keeps a fallback; switching preserves parameters and aliases. */
const toSqlQueryFallback = (
  definition: MutableDefinition,
  query: MutableQuery
): NonNullable<MutableQuery['fallback']> => {
  const fallback = clone(query.fallback!);
  if (!fallback.outputs?.length) {
    const aliases =
      definition.kind === 'records'
        ? definition.select.map((projection) => projection.alias)
        : [...(definition.groupBy ?? []), ...definition.aggregates].map((entry) => entry.alias);
    fallback.outputs = aliases.map((alias) => ({ alias }));
  }
  if (!fallback.parameters && definition.parameters) {
    fallback.parameters = clone(definition.parameters);
  }
  return fallback;
};

type QueryOutcome = {
  query: MutableQuery;
  classification: DataQueryRepairClassification;
  reasons: Set<DataQueryRepairReason>;
  actions: DataQueryRepairAction[];
};

const planQuery = (
  original: MutableQuery,
  target: ChangeTarget,
  kind: DataQuerySchemaChange['kind']
): QueryOutcome => {
  const query = clone(original);
  const reasons = new Set<DataQueryRepairReason>();
  const actions: DataQueryRepairAction[] = [];
  const outcome = (classification: DataQueryRepairClassification): QueryOutcome => ({
    query,
    classification,
    reasons,
    actions,
  });
  const fallbackMentionsTarget = Boolean(
    query.fallback && sqlMentionsIdentifier(query.fallback.sql, target.sqlIdentifier)
  );

  // A SQL path can read columns the structured index cannot see. The name is
  // the only correlation available; without it the query is unknown, never
  // unaffected.
  if (!query.definition || query.mode === 'sql-query') {
    reasons.add(fallbackMentionsTarget ? 'fallback_references_field' : 'sql_query_unverifiable');
    return outcome('manual');
  }

  const definition = query.definition;

  if (kind === 'table_deleted' && definition.tableId === target.tableId) {
    reasons.add('table_deleted');
    return outcome('manual');
  }

  // A fallback is the declared alternate path. If it names the affected field,
  // no structured repair makes the query safe; SQL is never rewritten.
  if (fallbackMentionsTarget) {
    reasons.add('fallback_references_field');
    return outcome('manual');
  }

  if (kind === 'field_updated') {
    const referenced =
      Object.values(relationsOf(definition)).some(
        (relation) => relation.linkFieldId === target.fieldId
      ) ||
      [...collectDataQuerySourceFieldUsages(definition).values()].some((fields) =>
        fields.has(target.fieldId!)
      );
    if (!referenced) return outcome('noop');
    if (target.typeChanged && target.outputCompatible !== true) {
      reasons.add('type_change_affects_output');
      return outcome('manual');
    }
    // Names and types are not embedded in the manifest; only generated live
    // descriptions change, and those are regenerated on the next save.
    return outcome('noop');
  }

  if (kind === 'field_replaced' && target.fieldId) {
    if (!target.replacementFieldId) {
      reasons.add('ambiguous_field_mapping');
      return outcome('manual');
    }
    if (target.outputCompatible === false) {
      reasons.add('type_change_affects_output');
      return outcome('manual');
    }
    const usages = new Set<string>();
    rewriteFieldReferences(definition, target, target.replacementFieldId, usages);
    if (!usages.size) return outcome('noop');
    reasons.add('field_reference_rewritten');
    actions.push({
      kind: 'rewrite_field',
      fromFieldId: target.fieldId,
      toFieldId: target.replacementFieldId,
      usages: [...usages].sort(),
    });
    return outcome('auto');
  }

  const record = actionsOf(reasons, actions);
  const removedAliases = new Set<string>();
  let affected = false;
  // Filter and grouping changes alter which rows or groups a query returns.
  // They are suggested, never classified as a safe automatic repair.
  let semanticsChanged = false;

  // --- Relations: a deleted link field or a deleted target table drops the
  // alias, its dependants and every via hop that went through it.
  if (kind !== 'field_deleted' && kind !== 'table_deleted') {
    return outcome('noop');
  }
  const relations = relationsOf(definition);
  const droppedRelations = new Set<string>();
  for (const [alias, relation] of Object.entries(relations)) {
    const deletedLink =
      kind === 'field_deleted' &&
      relation.linkFieldId === target.fieldId &&
      linkHostTable(definition, relation) === target.tableId;
    const deletedTarget = kind === 'table_deleted' && relation.tableId === target.tableId;
    if (deletedLink || deletedTarget) droppedRelations.add(alias);
  }
  if (droppedRelations.size) {
    let cascaded = true;
    while (cascaded) {
      cascaded = false;
      for (const [alias, relation] of Object.entries(relations)) {
        if (droppedRelations.has(alias) || !relation.via) continue;
        if (!droppedRelations.has(relation.via)) continue;
        droppedRelations.add(alias);
        cascaded = true;
      }
    }
    for (const alias of droppedRelations) {
      delete relations[alias];
      record.add({ kind: 'remove_relation', alias }, 'relation_removed');
      affected = true;
    }
    if (!Object.keys(relations).length) {
      delete (definition as Extract<MutableDefinition, { version: 2 }>).relations;
    }
  }

  // Dependants of a dropped relation cannot stay: a join edge that no longer
  // exists would fail admission.
  if (definition.kind === 'records') {
    const kept: DataQueryRecordsProjection[] = [];
    for (const projection of definition.select) {
      if (droppedRelations.has(sourceOf(projection))) {
        affected = true;
        removedAliases.add(projection.alias);
        record.add({ kind: 'remove_projection', alias: projection.alias }, 'relation_removed');
        continue;
      }
      if (kind === 'field_deleted') {
        const fieldId = 'fieldId' in projection ? projection.fieldId : undefined;
        if (
          fieldId &&
          tableOfSource(definition, sourceOf(projection)) === target.tableId &&
          fieldId === target.fieldId
        ) {
          affected = true;
          removedAliases.add(projection.alias);
          record.add(
            { kind: 'remove_projection', alias: projection.alias },
            'statisticFunc' in projection ? 'field_deleted_aggregate' : 'field_deleted_projection'
          );
          continue;
        }
      }
      kept.push(projection);
    }
    definition.select = kept as [DataQueryRecordsProjection, ...DataQueryRecordsProjection[]];
  } else {
    definition.aggregates = definition.aggregates.filter((aggregate) => {
      if (
        kind === 'field_deleted' &&
        tableOfSource(definition, 'root') === target.tableId &&
        aggregate.fieldId === target.fieldId
      ) {
        affected = true;
        removedAliases.add(aggregate.alias);
        record.add({ kind: 'remove_aggregate', alias: aggregate.alias }, 'field_deleted_aggregate');
        return false;
      }
      return true;
    }) as typeof definition.aggregates;
    definition.groupBy = definition.groupBy?.filter((group) => {
      if (droppedRelations.has(sourceOf(group))) {
        affected = true;
        semanticsChanged = true;
        removedAliases.add(group.alias);
        record.add({ kind: 'remove_group_by', alias: group.alias }, 'group_semantics_changed');
        return false;
      }
      if (
        kind === 'field_deleted' &&
        tableOfSource(definition, sourceOf(group)) === target.tableId &&
        group.fieldId === target.fieldId
      ) {
        affected = true;
        semanticsChanged = true;
        removedAliases.add(group.alias);
        record.add({ kind: 'remove_group_by', alias: group.alias }, 'group_semantics_changed');
        return false;
      }
      return true;
    });
    if (definition.groupBy?.length === 0) delete definition.groupBy;
  }

  if (kind === 'field_deleted') {
    if (definition.filter) {
      const next = removeFilterLeaves(definition.filter, definition, 'root', target);
      if (next.removed) {
        affected = true;
        semanticsChanged = true;
        record.add({ kind: 'remove_filter', source: 'root' }, 'filter_semantics_changed');
        if (next.node) definition.filter = next.node;
        else delete definition.filter;
      }
    }
    for (const [alias, relation] of Object.entries(relations)) {
      if (!relation.filter) continue;
      const next = removeFilterLeaves(relation.filter, definition, alias, target);
      if (!next.removed) continue;
      affected = true;
      semanticsChanged = true;
      record.add({ kind: 'remove_filter', source: alias }, 'filter_semantics_changed');
      if (next.node) relation.filter = next.node;
      else delete relation.filter;
    }
  }

  const keptSort: DataQuerySort[] = [];
  (definition.sort ?? []).forEach((item, index) => {
    if ('fieldId' in item) {
      if (
        kind === 'field_deleted' &&
        tableOfSource(definition, sourceOf(item)) === target.tableId &&
        item.fieldId === target.fieldId
      ) {
        affected = true;
        record.add({ kind: 'remove_sort', index }, 'field_deleted_sort');
        return;
      }
      if (droppedRelations.has(sourceOf(item))) {
        affected = true;
        record.add({ kind: 'remove_sort', index }, 'relation_removed');
        return;
      }
      keptSort.push(item);
      return;
    }
    if ('allowed' in item) {
      const allowed = item.allowed.filter((allowedTarget) => {
        if (!('fieldId' in allowedTarget) || kind !== 'field_deleted') return true;
        return !(
          tableOfSource(definition, sourceOf(allowedTarget)) === target.tableId &&
          allowedTarget.fieldId === target.fieldId
        );
      });
      if (allowed.length !== item.allowed.length) {
        affected = true;
        record.add({ kind: 'trim_sort_allow_list', index }, 'field_deleted_sort');
      }
      if (!allowed.length) {
        record.add({ kind: 'remove_sort', index }, 'field_deleted_sort');
        return;
      }
      keptSort.push({ ...item, allowed });
      return;
    }
    if ('alias' in item && removedAliases.has(item.alias)) {
      affected = true;
      record.add({ kind: 'remove_sort', index, alias: item.alias }, 'field_deleted_sort');
      return;
    }
    keptSort.push(item);
  });
  if (definition.sort) {
    if (keptSort.length) definition.sort = keptSort;
    else delete definition.sort;
  }

  if (!affected) return outcome('noop');

  pruneFallbackOutputs(query, removedAliases, actions);

  // A semantics-changing rewrite stays a suggestion: the diff shows the edit,
  // but apply is refused until a human applies it outside this flow.
  if (semanticsChanged) return outcome('manual');

  const empty =
    definition.kind === 'records'
      ? definition.select.length === 0
      : definition.aggregates.length === 0;
  if (empty) {
    if (query.mode === 'auto' && query.fallback) {
      // The SQL contract is unchanged by a structured repair; derive it from
      // the accepted query, not the emptied definition.
      const fallback = toSqlQueryFallback(original.definition!, original);
      query.mode = 'sql-query';
      query.fallback = fallback;
      delete query.definition;
      reasons.add('switch_to_fallback');
      actions.push({ kind: 'switch_to_fallback' });
      return outcome('auto');
    }
    reasons.add('definition_empty');
    return outcome('manual');
  }

  return outcome('auto');
};

const buildTarget = (change: DataQuerySchemaChange): ChangeTarget => {
  switch (change.kind) {
    case 'field_deleted':
      return { tableId: change.tableId, fieldId: change.fieldId, sqlIdentifier: change.fieldName };
    case 'table_deleted':
      return { tableId: change.tableId };
    case 'field_updated':
      return {
        tableId: change.tableId,
        fieldId: change.fieldId,
        sqlIdentifier: change.previousName ?? change.fieldName,
        typeChanged: change.typeChanged === true,
        outputCompatible: change.outputCompatible,
      };
    case 'field_replaced':
      return {
        tableId: change.tableId,
        fieldId: change.fieldId,
        replacementFieldId: change.replacementFieldId,
        sqlIdentifier: change.previousName,
        outputCompatible: change.outputCompatible,
      };
  }
};

/**
 * Pure repair plan for one accepted manifest and one schema change. The result
 * is deterministic: the same inputs always produce identical JSON, which is
 * what the preview hash and the audit record rely on.
 */
export const planDataQueryManifestRepair = (
  manifest: DataQueryManifest,
  change: DataQuerySchemaChange
): DataQueryManifestRepairPlan => {
  const target = buildTarget(change);
  const preview = clone(manifest);
  const plans: DataQueryRepairQueryPlan[] = [];
  for (const [queryId, query] of Object.entries(manifest.queries)) {
    const outcome = planQuery(query, target, change.kind);
    if (outcome.actions.length) preview.queries[queryId] = outcome.query;
    plans.push({
      queryId,
      classification: outcome.classification,
      reasons: [...outcome.reasons],
      actions: outcome.actions,
    });
  }
  const summary = {
    auto: plans.filter((plan) => plan.classification === 'auto').length,
    manual: plans.filter((plan) => plan.classification === 'manual').length,
    noop: plans.filter((plan) => plan.classification === 'noop').length,
  };
  const blockingQueryIds = plans
    .filter((plan) => plan.classification === 'manual')
    .map((plan) => plan.queryId);
  const applyable = summary.auto > 0 && blockingQueryIds.length === 0;
  return {
    change,
    queries: plans,
    summary,
    applyable,
    blockingQueryIds,
    ...(applyable ? { repaired: clone(preview) } : {}),
    ...(plans.some((plan) => plan.actions.length) ? { preview } : {}),
  };
};

type JsonDiffEntry = { path: string; before?: unknown; after?: unknown };

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const jsonDiff = (before: unknown, after: unknown, path: string, out: JsonDiffEntry[]): void => {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= before.length) out.push({ path: `${path}[${index}]`, after: after[index] });
      else if (index >= after.length)
        out.push({ path: `${path}[${index}]`, before: before[index] });
      else jsonDiff(before[index], after[index], `${path}[${index}]`, out);
    }
    return;
  }
  if (isJsonObject(before) && isJsonObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key;
      if (!(key in before)) out.push({ path: nextPath, after: after[key] });
      else if (!(key in after)) out.push({ path: nextPath, before: before[key] });
      else jsonDiff(before[key], after[key], nextPath, out);
    }
    return;
  }
  out.push({ path, before, after });
};

/**
 * Structural preview of the repaired manifest. Only queries the plan touched
 * are reported, so the diff stays readable and stable.
 */
export const diffDataQueryManifestRepair = (
  before: DataQueryManifest,
  plan: DataQueryManifestRepairPlan
): DataQueryManifestRepairDiff => {
  const after = plan.preview ?? plan.repaired ?? before;
  return {
    queries: plan.queries.flatMap((query) => {
      const patches: DataQueryManifestPatch[] = [];
      jsonDiff(
        before.queries[query.queryId],
        after.queries[query.queryId],
        `queries.${query.queryId}`,
        patches
      );
      // A manual query with no suggested edit (e.g. an unverifiable SQL path)
      // is a blocker, not a visible change.
      if (!patches.length) return [];
      return [
        {
          queryId: query.queryId,
          classification: query.classification,
          reasons: query.reasons,
          actions: query.actions,
          patches,
        },
      ];
    }),
  };
};

/**
 * Canonical YAML for a repaired manifest. Repairs rewrite the whole document;
 * comments and blank lines in the accepted file are not preserved. Callers must
 * show this exact text in the preview before an apply.
 */
export const serializeDataQueryManifest = (manifest: DataQueryManifest): string =>
  stringifyYaml(manifest, { lineWidth: 0 });
