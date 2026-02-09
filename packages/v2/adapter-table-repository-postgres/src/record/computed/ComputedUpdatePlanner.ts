import { domainError, FieldId, TableId } from '@teable/v2-core';
import type {
  BaseId,
  ConditionalLookupField,
  ConditionalRollupField,
  DomainError,
  FormulaField,
  IExecutionContext,
  RecordId,
  Table,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { extractConditionFieldIds } from '@teable/v2-field-dependency-core';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { FieldDependencyEdge, FieldDependencyGraph, FieldMeta } from './FieldDependencyGraph';

export type UpdateContext = {
  table: Table;
  changedFieldIds: ReadonlyArray<FieldId>;
  changedRecordIds: ReadonlyArray<RecordId>;
  changeType: 'insert' | 'update' | 'delete';
  impact?: UpdateImpactHint;
  cyclePolicy?: ComputedUpdateCyclePolicy;
};

export type ComputedSeedGroup = {
  tableId: TableId;
  recordIds: ReadonlyArray<RecordId>;
};

export type PlanStageContext = {
  baseId: BaseId;
  seedTableId: TableId;
  seedRecordIds: ReadonlyArray<RecordId>;
  extraSeedRecords: ReadonlyArray<ComputedSeedGroup>;
  changedFieldIds: ReadonlyArray<FieldId>;
  changeType: 'insert' | 'update' | 'delete';
  impact?: UpdateImpactHint;
  table?: Table;
  cyclePolicy?: ComputedUpdateCyclePolicy;
};

export type UpdateImpactHint = {
  valueFieldIds: ReadonlyArray<FieldId>;
  linkFieldIds: ReadonlyArray<FieldId>;
};

export type UpdateStep = {
  tableId: TableId;
  fieldIds: ReadonlyArray<FieldId>;
  level: number;
};

/**
 * A batch of same-table steps that can be executed together using CTE.
 * All steps in a batch are in the same table and only have same_record dependencies.
 */
export type SameTableBatch = {
  tableId: TableId;
  /** Steps ordered by level (dependency order) */
  steps: ReadonlyArray<UpdateStep>;
  /** The minimum level in this batch */
  minLevel: number;
  /** The maximum level in this batch */
  maxLevel: number;
};

export type DirtyPropagationMode = 'linkTraversal' | 'allTargetRecords' | 'conditionalFiltered';

export type ComputedUpdateCyclePolicy = 'error' | 'skip';

/**
 * Filter condition for conditionalFiltered propagation mode.
 * Used to precisely identify which target records need to be marked as dirty.
 */
export type ConditionalFilterCondition = {
  foreignTableId: TableId;
  /** Original filter DTO from the conditional field options */
  filterDto: unknown;
};

export type ComputedDependencyEdge = {
  fromFieldId: FieldId;
  toFieldId: FieldId;
  fromTableId: TableId;
  toTableId: TableId;
  linkFieldId?: FieldId;
  propagationMode?: DirtyPropagationMode;
  /** Filter condition for conditionalFiltered mode */
  filterCondition?: ConditionalFilterCondition;
  order: number;
};

export type ComputedUpdateCycleInfo = {
  readonly mode: 'skip';
  readonly unsortedFieldIds: ReadonlyArray<string>;
  readonly cycle: ReadonlyArray<string> | null;
  readonly sampleFields: ReadonlyArray<string>;
  readonly message: string;
};

export type ComputedUpdatePlan = {
  baseId: BaseId;
  seedTableId: TableId;
  seedRecordIds: ReadonlyArray<RecordId>;
  extraSeedRecords: ReadonlyArray<ComputedSeedGroup>;
  steps: ReadonlyArray<UpdateStep>;
  edges: ReadonlyArray<ComputedDependencyEdge>;
  estimatedComplexity: number;
  changeType: UpdateContext['changeType'];
  cyclePolicy?: ComputedUpdateCyclePolicy;
  /**
   * Same-table batches that can be executed using CTE optimization.
   * Batches are derived from steps by identifying consecutive same-table steps
   * that only have same_record dependencies between them.
   */
  sameTableBatches: ReadonlyArray<SameTableBatch>;
  cycleInfo?: ComputedUpdateCycleInfo;
};

type UpdateImpact = {
  includesLinkRelation: boolean;
  includesValueChange: boolean;
  valueSeedFieldIds: ReadonlyArray<FieldId>;
  linkSeedFieldIds: ReadonlyArray<FieldId>;
};

type UpdateImpactContext = Pick<UpdateContext, 'changedFieldIds' | 'changeType' | 'impact'>;

/**
 * Build an ordered update plan for computed fields (formula/lookup/rollup/link).
 *
 * Example
 * ```typescript
 * const plan = await planner.plan({
 *   table,
 *   changedFieldIds: [nameFieldId],
 *   changedRecordIds: [recordId],
 *   changeType: 'update',
 * });
 * // plan.steps are ordered by dependency level
 * ```
 */
@injectable()
export class ComputedUpdatePlanner {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.computedDependencyGraph)
    private readonly graph: FieldDependencyGraph
  ) {}

  async plan(
    context: UpdateContext,
    executionContext?: IExecutionContext
  ): Promise<Result<ComputedUpdatePlan, DomainError>> {
    return this.planStage(
      {
        baseId: context.table.baseId(),
        seedTableId: context.table.id(),
        seedRecordIds: context.changedRecordIds,
        extraSeedRecords: [],
        changedFieldIds: context.changedFieldIds,
        changeType: context.changeType,
        impact: context.impact,
        table: context.table,
        cyclePolicy: context.cyclePolicy,
      },
      executionContext
    );
  }

  async planStage(
    context: PlanStageContext,
    executionContext?: IExecutionContext
  ): Promise<Result<ComputedUpdatePlan, DomainError>> {
    return safeTry<ComputedUpdatePlan, DomainError>(
      async function* (this: ComputedUpdatePlanner) {
        // For INSERT, we need initial values for all stored computed fields, including those
        // that depend on "unprovided" (implicitly null) inputs, or have no dependencies at all.
        // Seed planning with all table fields so the incremental graph can include every computed field.
        const planningSeedFieldIds =
          context.changeType === 'insert' && context.table
            ? context.table.getFields().map((field) => field.id())
            : context.changedFieldIds;

        const graphData = yield* await this.graph.load(context.baseId, executionContext, {
          requiredFieldIds: planningSeedFieldIds,
        });
        const { fieldsById, edges } = graphData;

        const impactResult = resolveUpdateImpact(fieldsById, {
          changedFieldIds: planningSeedFieldIds,
          changeType: context.changeType,
          impact: context.impact,
        });
        if (impactResult.isErr()) return err(impactResult.error);
        const impact = impactResult.value;

        const valueSeedFieldIds = new Map<string, FieldId>();
        for (const fieldId of impact.valueSeedFieldIds) {
          valueSeedFieldIds.set(fieldId.toString(), fieldId);
        }

        // For DELETE operations, collect source fields that are depended on by
        // conditionalLookup/conditionalRollup fields in other tables.
        // These fields need to be seeds so the conditional fields get recalculated.
        if (context.changeType === 'delete') {
          for (const edge of edges) {
            // Only cross_record edges from the seed table
            if (edge.kind !== 'cross_record') continue;
            if (!edge.fromTableId.equals(context.seedTableId)) continue;

            // Only conditional field semantics (no linkFieldId)
            if (
              edge.semantic !== 'conditional_rollup_source' &&
              edge.semantic !== 'conditional_lookup_source'
            ) {
              continue;
            }

            // Add the source field as a value seed
            const fromFieldIdStr = edge.fromFieldId.toString();
            if (!valueSeedFieldIds.has(fromFieldIdStr)) {
              valueSeedFieldIds.set(fromFieldIdStr, edge.fromFieldId);
            }
          }
        }

        const linkSeedFieldIds = new Map<string, FieldId>();
        for (const fieldId of impact.linkSeedFieldIds) {
          linkSeedFieldIds.set(fieldId.toString(), fieldId);
        }

        // Link relation changes should also refresh symmetric link fields and their dependents.
        const symmetricLinkEdges: Array<{
          fromFieldId: FieldId;
          toFieldId: FieldId;
          fromTableId: TableId;
          toTableId: TableId;
        }> = [];

        if (impact.includesLinkRelation) {
          for (const linkFieldId of impact.linkSeedFieldIds) {
            const meta = fieldsById.get(linkFieldId.toString());
            if (!meta || meta.type !== 'link') continue;

            const symmetricFieldId = meta.options?.symmetricFieldId;
            const foreignTableId = meta.options?.foreignTableId;
            if (!symmetricFieldId || !foreignTableId) continue;

            const symmetricFieldResult = FieldId.create(symmetricFieldId);
            if (symmetricFieldResult.isErr()) return err(symmetricFieldResult.error);
            const foreignTableResult = TableId.create(foreignTableId);
            if (foreignTableResult.isErr()) return err(foreignTableResult.error);

            const symmetricKey = symmetricFieldResult.value.toString();

            // For cross-base links, the symmetric field is in a different base
            // and won't be loaded in fieldsById (which only loads current base fields).
            // Create a FieldMeta for it so it can be included in update steps.
            if (!fieldsById.has(symmetricKey)) {
              // Build symmetric field's options by mirroring the original link field
              const symmetricOptions = {
                foreignTableId: meta.tableId.toString(),
                lookupFieldId: meta.options?.lookupFieldId ?? '',
                symmetricFieldId: meta.id.toString(),
                // Keep the same junction table info (symmetric link uses the same junction)
                fkHostTableName: meta.options?.fkHostTableName,
                // Reverse the relationship
                relationship: reverseRelationship(meta.options?.relationship),
              };

              fieldsById.set(symmetricKey, {
                id: symmetricFieldResult.value,
                tableId: foreignTableResult.value,
                type: 'link',
                isComputed: true,
                options: symmetricOptions,
                lookupOptions: null,
                conditionalOptions: null,
              });
            }

            symmetricLinkEdges.push({
              fromFieldId: meta.id,
              toFieldId: symmetricFieldResult.value,
              fromTableId: meta.tableId,
              toTableId: foreignTableResult.value,
            });
          }
        }

        const affectedFieldIds = new Set<string>();

        // For INSERT, include seeds as fallback (even if reference graph is incomplete).
        // For UPDATE/DELETE and follow-up stages, exclude seeds that aren't also dependents.
        const includeSeedsAlways = context.changeType === 'insert';

        if (impact.includesValueChange && valueSeedFieldIds.size > 0) {
          const valueEdges = edges.filter(isEdgeRelevantForValue);
          for (const fieldId of collectDirectAffectedFieldIds(
            valueEdges,
            [...valueSeedFieldIds.values()],
            includeSeedsAlways
          )) {
            affectedFieldIds.add(fieldId);
          }
        }
        if (impact.includesLinkRelation && linkSeedFieldIds.size > 0) {
          const linkEdges = edges.filter(isEdgeRelevantForLink);
          const linkRelationSeedIds: FieldId[] = [];
          for (const fieldId of linkSeedFieldIds.values()) {
            affectedFieldIds.add(fieldId.toString());
            linkRelationSeedIds.push(fieldId);
          }

          const linkRelationValueSeeds: FieldId[] = [...linkRelationSeedIds];
          for (const fieldId of collectDirectAffectedFieldIds(
            linkEdges,
            linkRelationSeedIds,
            includeSeedsAlways
          )) {
            affectedFieldIds.add(fieldId);
            const meta = fieldsById.get(fieldId);
            if (meta) {
              linkRelationValueSeeds.push(meta.id);
            }
          }

          // Add symmetric link fields and traverse from them to find dependent lookups
          const symmetricFieldIds: FieldId[] = [];
          for (const edge of symmetricLinkEdges) {
            affectedFieldIds.add(edge.toFieldId.toString());
            symmetricFieldIds.push(edge.toFieldId);
            linkRelationValueSeeds.push(edge.toFieldId);
          }

          // Traverse from symmetric link fields to find lookups that depend on them
          // e.g., when setting Parent.Children link, Child.Parent (symmetric) gets updated,
          // and Child.ParentName (lookup via Child.Parent) should also be updated
          if (symmetricFieldIds.length > 0) {
            for (const fieldId of collectDirectAffectedFieldIds(
              linkEdges,
              symmetricFieldIds,
              includeSeedsAlways
            )) {
              affectedFieldIds.add(fieldId);
              const meta = fieldsById.get(fieldId);
              if (meta) {
                linkRelationValueSeeds.push(meta.id);
              }
            }
          }

          // Link relation changes can cascade into value-dependent fields (formula/lookup/rollup/etc).
          const valueEdges = edges.filter(isEdgeRelevantForValue);
          for (const fieldId of collectDirectAffectedFieldIds(
            valueEdges,
            linkRelationValueSeeds,
            includeSeedsAlways
          )) {
            affectedFieldIds.add(fieldId);
          }
        }

        // INSERT: conditional fields (conditionalRollup/conditionalLookup) depend only on
        // foreign-table changes and can be "invisible" to same-record dependency scanning.
        // Ensure they're computed for newly inserted records so stored reads are correct.
        if (context.changeType === 'insert' && context.table) {
          for (const field of context.table.getFields()) {
            const fieldType = field.type().toString();
            if (fieldType !== 'conditionalRollup' && fieldType !== 'conditionalLookup') continue;

            const fieldId = field.id().toString();
            if (!fieldsById.has(fieldId)) {
              const conditionalOptions = (() => {
                if (fieldType === 'conditionalRollup') {
                  const config = (field as ConditionalRollupField).configDto();
                  const filter = config.condition?.filter ?? null;
                  return {
                    foreignTableId: config.foreignTableId,
                    lookupFieldId: config.lookupFieldId,
                    conditionFieldIds: extractConditionFieldIds(filter),
                    filterDto: filter,
                  };
                }

                const config = (field as ConditionalLookupField).conditionalLookupOptionsDto();
                const filter = config.condition?.filter ?? null;
                return {
                  foreignTableId: config.foreignTableId,
                  lookupFieldId: config.lookupFieldId,
                  conditionFieldIds: extractConditionFieldIds(filter),
                  filterDto: filter,
                };
              })();

              fieldsById.set(fieldId, {
                id: field.id(),
                tableId: context.seedTableId,
                type: fieldType,
                isComputed: field.computed().toBoolean(),
                options: null,
                lookupOptions: null,
                conditionalOptions,
              });
            }

            affectedFieldIds.add(fieldId);
          }
        }

        // Include context-free formulas (no field dependencies) so stored reads stay consistent.
        if (context.changeType !== 'delete' && context.table) {
          for (const field of context.table.getFields()) {
            if (field.type().toString() !== 'formula') continue;
            const formulaField = field as FormulaField;
            if (formulaField.dependencies().length > 0) continue;
            const refsResult = formulaField.expression().getReferencedFieldIds();
            if (refsResult.isOk() && refsResult.value.length > 0) continue;
            if (refsResult.isErr()) continue;
            const fieldId = field.id().toString();
            // Add to affectedFieldIds AND ensure fieldsById has metadata for this field
            // (for UPDATE operations, the formula may not have been loaded since it wasn't in changedFieldIds)
            if (!fieldsById.has(fieldId)) {
              fieldsById.set(fieldId, {
                id: field.id(),
                tableId: context.seedTableId,
                type: 'formula',
                isComputed: true,
                options: null,
                lookupOptions: null,
                conditionalOptions: null,
              });
            }
            affectedFieldIds.add(fieldId);
          }
        }

        const includeValueEdges = impact.includesValueChange || impact.includesLinkRelation;
        let relevantEdges = edges.filter(
          (edge) =>
            (includeValueEdges && isEdgeRelevantForValue(edge)) ||
            (impact.includesLinkRelation && isEdgeRelevantForLink(edge))
        );
        let computedFieldIds = filterComputedFields(fieldsById, affectedFieldIds);
        let cycleInfo: ComputedUpdateCycleInfo | undefined;

        // For INSERT operations, filter out oneMany link fields in the seed table
        // that were NOT explicitly set. These fields have their FK in the foreign table
        // (not the current table), so a newly inserted record cannot have any FK pointing
        // to it yet. This avoids unnecessary null → null computed updates.
        // However, if the user explicitly sets the oneMany link value, we need to compute it.
        if (context.changeType === 'insert') {
          const explicitlyChangedFieldIds = new Set(
            context.changedFieldIds.map((id) => id.toString())
          );
          computedFieldIds = filterOneManyLinksOnInsert(
            fieldsById,
            computedFieldIds,
            context.seedTableId,
            explicitlyChangedFieldIds
          );
        }

        if (computedFieldIds.size === 0) {
          return ok({
            baseId: context.baseId,
            seedTableId: context.seedTableId,
            seedRecordIds: context.seedRecordIds,
            extraSeedRecords: context.extraSeedRecords,
            steps: [],
            edges: [],
            estimatedComplexity: 0,
            changeType: context.changeType,
            cyclePolicy: context.cyclePolicy,
            sameTableBatches: [],
          });
        }

        const { ordered, levels } = topoSort(relevantEdges, computedFieldIds);
        if (ordered.length !== computedFieldIds.size) {
          // Find which fields couldn't be sorted (potential cycle participants)
          const orderedSet = new Set(ordered);
          const unsortedFieldIds = [...computedFieldIds].filter((id) => !orderedSet.has(id));

          // Build adjacency list for unsorted fields to find cycles
          const unsortedSet = new Set(unsortedFieldIds);
          const adjacency = new Map<string, string[]>();
          for (const id of unsortedFieldIds) {
            adjacency.set(id, []);
          }
          for (const edge of relevantEdges) {
            const from = edge.fromFieldId.toString();
            const to = edge.toFieldId.toString();
            if (unsortedSet.has(from) && unsortedSet.has(to)) {
              adjacency.get(from)!.push(to);
            }
          }

          // Find one cycle using DFS
          const findCycle = (): string[] | null => {
            const visited = new Set<string>();
            const inStack = new Set<string>();
            const parent = new Map<string, string>();

            const dfs = (node: string): string | null => {
              visited.add(node);
              inStack.add(node);
              for (const neighbor of adjacency.get(node) ?? []) {
                if (!visited.has(neighbor)) {
                  parent.set(neighbor, node);
                  const cycleEnd = dfs(neighbor);
                  if (cycleEnd) return cycleEnd;
                } else if (inStack.has(neighbor)) {
                  // Found cycle, return the node where cycle starts
                  parent.set(neighbor, node);
                  return neighbor;
                }
              }
              inStack.delete(node);
              return null;
            };

            for (const node of unsortedFieldIds) {
              if (!visited.has(node)) {
                const cycleEnd = dfs(node);
                if (cycleEnd) {
                  // Reconstruct cycle path
                  const cycle: string[] = [cycleEnd];
                  let current = parent.get(cycleEnd);
                  while (current && current !== cycleEnd) {
                    cycle.push(current);
                    current = parent.get(current);
                  }
                  cycle.push(cycleEnd);
                  return cycle.reverse();
                }
              }
            }
            return null;
          };

          const cycle = findCycle();
          const cycleInfoText = cycle
            ? cycle
                .map((id) => {
                  const meta = fieldsById.get(id);
                  return meta ? `${id}(${meta.type})` : id;
                })
                .join(' -> ')
            : 'No direct cycle found (may be disconnected components)';

          // Sample some unsorted fields with details
          const sampleFields = unsortedFieldIds.slice(0, 5).map((id) => {
            const meta = fieldsById.get(id);
            if (!meta) return `${id}(not found)`;
            const symId = meta.options?.symmetricFieldId;
            return `${id}(${meta.type}${symId ? `, sym=${symId}` : ''})`;
          });

          const message = `Computed field dependency cycle detected. Total unsorted: ${unsortedFieldIds.length}. Cycle: [${cycleInfoText}]. Sample fields: [${sampleFields.join(', ')}]`;
          const allowSkip = context.cyclePolicy === 'skip';
          if (!allowSkip) {
            return err(
              domainError.conflict({
                message,
              })
            );
          }

          computedFieldIds = orderedSet;
          relevantEdges = relevantEdges.filter(
            (edge) =>
              orderedSet.has(edge.fromFieldId.toString()) &&
              orderedSet.has(edge.toFieldId.toString())
          );
          cycleInfo = {
            mode: 'skip',
            unsortedFieldIds,
            cycle: cycle ?? null,
            sampleFields,
            message,
          };

          if (computedFieldIds.size === 0) {
            return ok({
              baseId: context.baseId,
              seedTableId: context.seedTableId,
              seedRecordIds: context.seedRecordIds,
              extraSeedRecords: context.extraSeedRecords,
              steps: [],
              edges: [],
              estimatedComplexity: 0,
              changeType: context.changeType,
              cyclePolicy: context.cyclePolicy,
              sameTableBatches: [],
              cycleInfo,
            });
          }
        }

        const steps = yield* buildSteps(ordered, levels, fieldsById);

        // For delete operations, filter out steps that update the seed table itself.
        // The seed records are being deleted, so there's no point updating their computed fields.
        const filteredSteps =
          context.changeType === 'delete'
            ? steps.filter((step) => !step.tableId.equals(context.seedTableId))
            : steps;

        const propagationEdges = yield* buildPropagationEdges(
          relevantEdges,
          fieldsById,
          computedFieldIds,
          levels,
          symmetricLinkEdges,
          context.changedFieldIds,
          context.changeType
        );

        // Build same-table batches for CTE optimization
        const sameTableBatches = buildSameTableBatches(filteredSteps, relevantEdges);

        const seedRecordCount = countSeedRecords(context.seedRecordIds, context.extraSeedRecords);
        const estimatedComplexity =
          filteredSteps.length + propagationEdges.length + seedRecordCount;

        return ok({
          baseId: context.baseId,
          seedTableId: context.seedTableId,
          seedRecordIds: context.seedRecordIds,
          extraSeedRecords: context.extraSeedRecords,
          steps: filteredSteps,
          edges: propagationEdges,
          estimatedComplexity,
          changeType: context.changeType,
          cyclePolicy: context.cyclePolicy,
          sameTableBatches,
          cycleInfo,
        });
      }.bind(this)
    );
  }
}

const resolveUpdateImpact = (
  fieldsById: Map<string, FieldMeta>,
  context: UpdateImpactContext
): Result<UpdateImpact, DomainError> => {
  if (context.impact) {
    const valueSeedFieldIds = context.impact.valueFieldIds;
    const linkSeedFieldIds = context.impact.linkFieldIds;
    return ok({
      includesLinkRelation: linkSeedFieldIds.length > 0 || context.changeType === 'delete',
      includesValueChange: valueSeedFieldIds.length > 0 || context.changeType === 'delete',
      valueSeedFieldIds,
      linkSeedFieldIds,
    });
  }

  // Split change impact into value changes vs link-relation changes.
  const valueSeedFieldIds: FieldId[] = [];
  const linkSeedFieldIds: FieldId[] = [];
  let includesValueChange = false;
  let includesLinkRelation = false;

  for (const fieldId of context.changedFieldIds) {
    const meta = fieldsById.get(fieldId.toString());
    if (!meta) continue;
    if (meta.type === 'link') {
      // Note: oneMany link fields are NOT filtered here. They are filtered later in
      // filterOneManyLinksOnInsert which has access to explicitly changed field IDs
      // and can properly distinguish between user-set links vs implicit null links.
      includesLinkRelation = true;
      linkSeedFieldIds.push(meta.id);
      continue;
    }
    includesValueChange = true;
    valueSeedFieldIds.push(fieldId);
  }

  if (context.changeType === 'delete') {
    includesValueChange = true;
    includesLinkRelation = includesLinkRelation || linkSeedFieldIds.length > 0;
  }

  return ok({
    includesLinkRelation,
    includesValueChange,
    valueSeedFieldIds,
    linkSeedFieldIds,
  });
};

/**
 * Value changes propagate through all edges except lookup_link dependencies.
 * lookup_link represents link-relation dependencies, which should only update
 * when the relation changes (not when link titles change).
 */
const isEdgeRelevantForValue = (edge: FieldDependencyEdge): boolean =>
  edge.kind === 'cross_record' || (edge.kind === 'same_record' && edge.semantic !== 'lookup_link');

/**
 * Link relation changes only propagate through edges that depend on the link relationship.
 * This includes:
 * - same_record edges where semantic is 'lookup_link' (lookup depends on which link)
 * - Symmetric link updates (handled separately)
 *
 * Note: For link relation changes, we DON'T propagate through 'link_title' or 'lookup_source'
 * edges because those depend on values, not relationships.
 */
const isEdgeRelevantForLink = (edge: FieldDependencyEdge): boolean =>
  // Only edges that depend on link relationships, not values
  edge.kind === 'same_record' && edge.semantic === 'lookup_link';

/**
 * Collect all transitively affected field IDs starting from the seed fields.
 *
 * Uses BFS to traverse the dependency graph and find all fields that depend on
 * the seed fields, directly or transitively.
 *
 * @param includeSeedsAlways - If true, all seeds are included in the result (for INSERT).
 *   If false, seeds are only included if they are ALSO found as dependents of other seeds
 *   (for UPDATE/DELETE and follow-up stages). This prevents infinite loops where a
 *   computed field that was just updated gets re-added to the update queue.
 *
 * Example with includeSeedsAlways=false: If seeds=[A, B] and B depends on A:
 * - A is a seed but NOT found as a dependent → excluded
 * - B is a seed AND found as dependent of A → included
 */
const collectDirectAffectedFieldIds = (
  edges: ReadonlyArray<FieldDependencyEdge>,
  seedFieldIds: ReadonlyArray<FieldId>,
  includeSeedsAlways: boolean = false
): Set<string> => {
  // Build adjacency list for efficient traversal
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = edge.fromFieldId.toString();
    const to = edge.toFieldId.toString();
    if (!adjacency.has(from)) {
      adjacency.set(from, []);
    }
    adjacency.get(from)!.push(to);
  }

  // Track seeds separately
  const seedSet = new Set<string>(seedFieldIds.map((id) => id.toString()));

  // Track fields that were discovered as dependents (not just added as seeds)
  const foundAsDependents = new Set<string>();

  // BFS to find all transitively affected fields
  // Initialize visited with seeds to prevent cycles
  const visited = new Set<string>();
  const queue: string[] = [...seedSet];
  for (const seed of queue) {
    visited.add(seed);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      // Mark this field as discovered through traversal
      foundAsDependents.add(neighbor);

      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // If includeSeedsAlways is true (INSERT), include all visited (seeds + dependents)
  if (includeSeedsAlways) {
    return visited;
  }

  // Otherwise (UPDATE/DELETE and follow-up stages):
  // - All non-seed fields that were visited (dependents)
  // - Seed fields that were ALSO found as dependents of other seeds
  const result = new Set<string>();
  for (const fieldId of visited) {
    // Include if NOT a seed, OR if it was found as a dependent
    if (!seedSet.has(fieldId) || foundAsDependents.has(fieldId)) {
      result.add(fieldId);
    }
  }

  return result;
};

const filterComputedFields = (
  fieldsById: Map<string, FieldMeta>,
  affectedFieldIds: Set<string>
): Set<string> => {
  const computed = new Set<string>();
  for (const fieldId of affectedFieldIds) {
    const meta = fieldsById.get(fieldId);
    if (!meta) continue;
    if (isComputedFieldType(meta.type)) {
      computed.add(fieldId);
    }
  }
  return computed;
};

/**
 * Filter out link fields that cannot have any value for INSERT operations.
 *
 * For INSERT operations, the following link fields are skipped (unless explicitly changed
 * OR they are symmetric links of explicitly changed fields):
 * 1. oneMany link fields in the seed table - the FK is stored in the foreign table,
 *    so a newly inserted record cannot have any FK pointing to it yet.
 * 2. Link fields in OTHER tables that have relationship manyOne or oneOne pointing
 *    TO the seed table, ONLY when:
 *    - The seed table doesn't have a manyOne/oneOne link pointing back, AND
 *    - The link is NOT a symmetric of an explicitly set oneMany link
 *    This handles the case where inserting into the One-side of a
 *    relationship doesn't need to update the Many-side's link titles.
 *
 * This prevents unnecessary null → null computed updates.
 *
 * @param explicitlyChangedFieldIds - Set of field IDs that were explicitly set by the user.
 *   These fields should NOT be filtered out even if they would normally be skipped.
 */
const filterOneManyLinksOnInsert = (
  fieldsById: Map<string, FieldMeta>,
  computedFieldIds: Set<string>,
  seedTableId: TableId,
  explicitlyChangedFieldIds: Set<string>
): Set<string> => {
  // First, check if the seed table has any manyOne/oneOne links (FK holder)
  // If so, we need to allow updates to symmetric links in other tables
  const seedTableHasFkLink = [...fieldsById.values()].some(
    (meta) =>
      meta.tableId.equals(seedTableId) &&
      meta.type === 'link' &&
      (meta.options?.relationship === 'manyOne' || meta.options?.relationship === 'oneOne')
  );

  // Build a set of symmetric field IDs for explicitly changed link fields
  // This ensures that if user sets a oneMany link, its symmetric manyOne is NOT filtered out
  const symmetricFieldIdsOfExplicitLinks = new Set<string>();
  for (const fieldId of explicitlyChangedFieldIds) {
    const meta = fieldsById.get(fieldId);
    if (meta?.type === 'link' && meta.options?.symmetricFieldId) {
      symmetricFieldIdsOfExplicitLinks.add(meta.options.symmetricFieldId);
    }
  }

  const filtered = new Set<string>();
  for (const fieldId of computedFieldIds) {
    const meta = fieldsById.get(fieldId);
    if (!meta) {
      filtered.add(fieldId);
      continue;
    }

    // Never filter out fields that were explicitly changed by the user
    if (explicitlyChangedFieldIds.has(fieldId)) {
      filtered.add(fieldId);
      continue;
    }

    // Never filter out symmetric links of explicitly changed link fields
    if (symmetricFieldIdsOfExplicitLinks.has(fieldId)) {
      filtered.add(fieldId);
      continue;
    }

    // Skip oneMany link fields in the seed table (FK is not here)
    // unless the user explicitly set the link value
    if (
      meta.type === 'link' &&
      meta.tableId.equals(seedTableId) &&
      meta.options?.relationship === 'oneMany'
    ) {
      continue;
    }

    // Skip link fields in OTHER tables that point TO the seed table,
    // but ONLY when the seed table doesn't have a manyOne/oneOne link.
    // If the seed table has FK links, we need to update symmetric fields.
    if (!seedTableHasFkLink && meta.type === 'link' && meta.options?.foreignTableId) {
      const foreignTableIdResult = TableId.create(meta.options.foreignTableId);
      if (foreignTableIdResult.isOk() && foreignTableIdResult.value.equals(seedTableId)) {
        // This link field points TO the seed table, and seed table doesn't have FK links
        continue;
      }
    }

    filtered.add(fieldId);
  }
  return filtered;
};

export const computedFieldTypes = new Set([
  'formula',
  'lookup',
  'rollup',
  'link',
  'conditionalLookup',
  'conditionalRollup',
]);

export const isComputedFieldType = (type: string): boolean => computedFieldTypes.has(type);

const countSeedRecords = (
  seedRecordIds: ReadonlyArray<RecordId>,
  extraSeedRecords: ReadonlyArray<ComputedSeedGroup>
): number => {
  let count = seedRecordIds.length;
  for (const group of extraSeedRecords) {
    count += group.recordIds.length;
  }
  return count;
};

export const splitSeedGroupsForPlan = (
  seedGroups: ReadonlyArray<ComputedSeedGroup>,
  preferredTableId?: TableId
): {
  seedTableId: TableId;
  seedRecordIds: ReadonlyArray<RecordId>;
  extraSeedRecords: ReadonlyArray<ComputedSeedGroup>;
} | null => {
  const nonEmpty = seedGroups.filter((group) => group.recordIds.length > 0);
  if (nonEmpty.length === 0) return null;

  const primary =
    preferredTableId === undefined
      ? nonEmpty[0]
      : nonEmpty.find((group) => group.tableId.equals(preferredTableId)) ?? nonEmpty[0];

  return {
    seedTableId: primary.tableId,
    seedRecordIds: primary.recordIds,
    extraSeedRecords: nonEmpty.filter((group) => group !== primary),
  };
};

const topoSort = (
  edges: ReadonlyArray<FieldDependencyEdge>,
  fieldIdSet: Set<string>
): { ordered: ReadonlyArray<string>; levels: Map<string, number> } => {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const levels = new Map<string, number>();

  for (const id of fieldIdSet) {
    indegree.set(id, 0);
    adjacency.set(id, []);
    levels.set(id, 0);
  }

  for (const edge of edges) {
    const from = edge.fromFieldId.toString();
    const to = edge.toFieldId.toString();
    if (!fieldIdSet.has(from) || !fieldIdSet.has(to)) continue;
    adjacency.get(from)!.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of indegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  const ordered: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.push(id);
    const nexts = adjacency.get(id) ?? [];
    for (const next of nexts) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      const nextLevel = Math.max(levels.get(next) ?? 0, (levels.get(id) ?? 0) + 1);
      levels.set(next, nextLevel);
      if (indegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  return { ordered, levels };
};

const buildSteps = (
  ordered: ReadonlyArray<string>,
  levels: Map<string, number>,
  fieldsById: Map<string, FieldMeta>
): Result<ReadonlyArray<UpdateStep>, DomainError> => {
  const grouped = new Map<string, { tableId: TableId; level: number; fieldIds: FieldId[] }>();
  for (const fieldId of ordered) {
    const meta = fieldsById.get(fieldId);
    if (!meta) {
      return err(domainError.notFound({ message: `Missing field metadata for ${fieldId}` }));
    }
    const level = levels.get(fieldId) ?? 0;
    const key = `${meta.tableId.toString()}|${level}`;
    const entry = grouped.get(key) ?? {
      tableId: meta.tableId,
      level,
      fieldIds: [],
    };
    entry.fieldIds.push(meta.id);
    grouped.set(key, entry);
  }

  const steps = [...grouped.values()];
  steps.sort((a, b) =>
    a.level === b.level
      ? a.tableId.toString().localeCompare(b.tableId.toString())
      : a.level - b.level
  );

  return ok(steps);
};

const buildPropagationEdges = (
  edges: ReadonlyArray<FieldDependencyEdge>,
  fieldsById: Map<string, FieldMeta>,
  computedFieldIds: Set<string>,
  levels: Map<string, number>,
  symmetricLinkEdges: ReadonlyArray<{
    fromFieldId: FieldId;
    toFieldId: FieldId;
    fromTableId: TableId;
    toTableId: TableId;
  }>,
  changedFieldIds: ReadonlyArray<FieldId>,
  changeType: 'insert' | 'update' | 'delete'
): Result<ReadonlyArray<ComputedDependencyEdge>, DomainError> => {
  const result: ComputedDependencyEdge[] = [];
  const changedFieldIdSet = new Set(changedFieldIds.map((id) => id.toString()));

  for (const edge of edges) {
    const toId = edge.toFieldId.toString();
    if (!computedFieldIds.has(toId)) continue;

    // Only cross_record edges need dirty record propagation
    // Note: cross_record includes self-referencing links (same table, different records)
    if (edge.kind !== 'cross_record') continue;

    const meta = fieldsById.get(toId);
    if (!meta) continue;

    const isConditionalField =
      meta.type === 'conditionalLookup' || meta.type === 'conditionalRollup';

    if (isConditionalField) {
      const conditionalOptions = meta.conditionalOptions;
      const filterFieldIds = new Set(conditionalOptions?.conditionFieldIds ?? []);
      const filterDto = conditionalOptions?.filterDto;
      const sourceTableId = edge.fromTableId.toString();
      const filterFieldsInSource = [...filterFieldIds].every((id) => {
        const fieldMeta = fieldsById.get(id);
        return fieldMeta?.tableId.toString() === sourceTableId;
      });

      // Check if any filter field was changed
      const filterFieldsChanged = [...filterFieldIds].some((id) => changedFieldIdSet.has(id));

      // Use allTargetRecords when:
      // 1. Filter fields were modified (can't determine old vs new match - records may enter/exit filter)
      // 2. No filter DTO available
      // 3. DELETE operation (records no longer exist for filter check)
      //
      // Note: When only the lookup field changes (but not filter fields), we can use conditionalFiltered
      // because the set of records matching the filter hasn't changed - only their values have.
      if (filterFieldsChanged || !filterDto || changeType === 'delete' || !filterFieldsInSource) {
        result.push({
          fromFieldId: edge.fromFieldId,
          toFieldId: edge.toFieldId,
          fromTableId: edge.fromTableId,
          toTableId: edge.toTableId,
          propagationMode: 'allTargetRecords',
          order: levels.get(toId) ?? 0,
        });
      } else {
        // Filter fields not changed - can use precise filtering
        result.push({
          fromFieldId: edge.fromFieldId,
          toFieldId: edge.toFieldId,
          fromTableId: edge.fromTableId,
          toTableId: edge.toTableId,
          propagationMode: 'conditionalFiltered',
          filterCondition: {
            foreignTableId: edge.fromTableId,
            filterDto,
          },
          order: levels.get(toId) ?? 0,
        });
      }
      continue;
    }

    // For cross_record edges, linkFieldId should be present on the edge
    let linkFieldId = edge.linkFieldId;

    // Fallback: derive linkFieldId from field metadata if not on edge
    if (!linkFieldId) {
      if (meta.type === 'lookup' || meta.type === 'rollup') {
        if (!meta.lookupOptions) {
          return err(
            domainError.validation({ message: `Missing lookupOptions for field ${toId}` })
          );
        }
        const linkFieldResult = FieldId.create(meta.lookupOptions.linkFieldId);
        if (linkFieldResult.isErr()) return err(linkFieldResult.error);
        linkFieldId = linkFieldResult.value;
      } else if (meta.type === 'link') {
        linkFieldId = meta.id;
      }
    }

    if (!linkFieldId) continue;

    // Check if lookup/rollup has filter fields that were changed
    if (meta.type === 'lookup' || meta.type === 'rollup') {
      const lookupOptions = meta.lookupOptions;
      const filterFieldIds = new Set(lookupOptions?.filterFieldIds ?? []);
      const filterDto = lookupOptions?.filterDto;

      // If filter fields exist and any was changed, use allTargetRecords propagation
      // because the filter match status may have changed
      if (filterFieldIds.size > 0) {
        const filterFieldsChanged = [...filterFieldIds].some((id) => changedFieldIdSet.has(id));

        if (filterFieldsChanged || changeType === 'delete') {
          result.push({
            fromFieldId: edge.fromFieldId,
            toFieldId: edge.toFieldId,
            fromTableId: edge.fromTableId,
            toTableId: edge.toTableId,
            linkFieldId,
            propagationMode: 'allTargetRecords',
            order: levels.get(toId) ?? 0,
          });
          continue;
        }

        // Filter fields not changed - use linkTraversal with filter
        result.push({
          fromFieldId: edge.fromFieldId,
          toFieldId: edge.toFieldId,
          fromTableId: edge.fromTableId,
          toTableId: edge.toTableId,
          linkFieldId,
          propagationMode: 'linkTraversal',
          filterCondition: filterDto ? { foreignTableId: edge.fromTableId, filterDto } : undefined,
          order: levels.get(toId) ?? 0,
        });
        continue;
      }
    }

    result.push({
      fromFieldId: edge.fromFieldId,
      toFieldId: edge.toFieldId,
      fromTableId: edge.fromTableId,
      toTableId: edge.toTableId,
      linkFieldId,
      propagationMode: 'linkTraversal',
      order: levels.get(toId) ?? 0,
    });
  }

  result.sort((a, b) => a.order - b.order);

  for (const edge of symmetricLinkEdges) {
    const toId = edge.toFieldId.toString();
    const order = levels.get(toId) ?? 0;
    result.push({
      fromFieldId: edge.fromFieldId,
      toFieldId: edge.toFieldId,
      fromTableId: edge.fromTableId,
      toTableId: edge.toTableId,
      linkFieldId: edge.toFieldId,
      propagationMode: 'linkTraversal',
      order,
    });
  }

  result.sort((a, b) => a.order - b.order);
  return ok(result);
};

/**
 * Build same-table batches from steps and edges.
 *
 * A batch groups consecutive steps for the same table where:
 * 1. All steps are in the same table
 * 2. Dependencies between steps are only same_record (not cross_record)
 *
 * This allows using CTE optimization to compute all fields in a single UPDATE.
 */
const buildSameTableBatches = (
  steps: ReadonlyArray<UpdateStep>,
  edges: ReadonlyArray<FieldDependencyEdge>
): ReadonlyArray<SameTableBatch> => {
  if (steps.length === 0) return [];

  // Build a map of cross_record dependencies for quick lookup
  const hasCrossRecordDependency = new Set<string>();
  for (const edge of edges) {
    if (edge.kind === 'cross_record') {
      // Mark the target field as having a cross_record dependency
      hasCrossRecordDependency.add(edge.toFieldId.toString());
    }
  }

  // Group steps by table
  const stepsByTable = new Map<string, UpdateStep[]>();
  for (const step of steps) {
    const tableId = step.tableId.toString();
    if (!stepsByTable.has(tableId)) {
      stepsByTable.set(tableId, []);
    }
    stepsByTable.get(tableId)!.push(step);
  }

  const batches: SameTableBatch[] = [];

  for (const [, tableSteps] of stepsByTable) {
    // Sort by level
    const sortedSteps = [...tableSteps].sort((a, b) => a.level - b.level);

    // Find consecutive steps that only have same_record dependencies
    let currentBatch: UpdateStep[] = [];
    let batchStartLevel = sortedSteps[0].level;

    for (const step of sortedSteps) {
      // Check if any field in this step has a cross_record dependency
      const hasCrossRecord = step.fieldIds.some((fieldId) =>
        hasCrossRecordDependency.has(fieldId.toString())
      );

      if (hasCrossRecord && currentBatch.length > 0) {
        // Current step has cross_record dependency - finalize current batch
        batches.push({
          tableId: currentBatch[0].tableId,
          steps: currentBatch,
          minLevel: batchStartLevel,
          maxLevel: currentBatch[currentBatch.length - 1].level,
        });
        currentBatch = [step];
        batchStartLevel = step.level;
      } else {
        // Add to current batch
        currentBatch.push(step);
      }
    }

    // Add final batch
    if (currentBatch.length > 0) {
      batches.push({
        tableId: currentBatch[0].tableId,
        steps: currentBatch,
        minLevel: batchStartLevel,
        maxLevel: currentBatch[currentBatch.length - 1].level,
      });
    }
  }

  // Sort batches by minLevel
  batches.sort((a, b) => a.minLevel - b.minLevel);

  return batches;
};

/**
 * Reverse a link relationship type for symmetric field.
 * manyOne <-> oneMany, oneOne <-> oneOne, manyMany <-> manyMany
 */
const reverseRelationship = (
  relationship: string | undefined
): 'oneMany' | 'manyOne' | 'oneOne' | 'manyMany' | undefined => {
  if (!relationship) return undefined;
  switch (relationship) {
    case 'manyOne':
      return 'oneMany';
    case 'oneMany':
      return 'manyOne';
    case 'oneOne':
      return 'oneOne';
    case 'manyMany':
      return 'manyMany';
    default:
      return undefined;
  }
};
