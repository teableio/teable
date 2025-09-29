/* eslint-disable sonarjs/no-collapsible-if */
import { CellValueType, FieldType, Relationship } from '@teable/core';
import type {
  FieldCore,
  ILinkFieldOptions,
  LinkFieldCore,
  TableDomain,
  FormulaFieldCore,
} from '@teable/core';

export function getTableAliasFromTable(table: TableDomain): string {
  // Use a short, deterministic alias derived from table id to avoid
  // collisions with the physical table name (especially when names are
  // truncated to 63 chars by Postgres). This guarantees the alias never
  // equals the underlying relation name and stays well within length limits.
  const safeId = table.id.replace(/\W/g, '_');
  return `t_${safeId}`;
}

export function getLinkUsesJunctionTable(field: LinkFieldCore): boolean {
  const options = field.options as ILinkFieldOptions;
  return (
    options.relationship === Relationship.ManyMany ||
    (options.relationship === Relationship.OneMany && !!options.isOneWay)
  );
}

/**
 * Compute a minimal, ordered field list based on a projection of field IDs.
 * - Always respects `table.fields.ordered` ordering.
 * - When projection is empty/undefined, returns all fields.
 * - Ensures dependencies are included:
 *   - Lookup → include its link field
 *   - Rollup → include its link field
 *   - Formula → recursively include referenced fields (and therefore their link deps)
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function getOrderedFieldsByProjection(
  table: TableDomain,
  projection?: string[]
): FieldCore[] {
  const ordered = table.fields.ordered as FieldCore[];
  if (!projection || projection.length === 0) return ordered;

  const byId: Record<string, FieldCore | undefined> = Object.fromEntries(
    ordered.map((f) => [f.id, f])
  );

  const wanted = new Set<string>(projection);
  const queue: string[] = [...wanted];
  const visitedFormula = new Set<string>();

  while (queue.length) {
    const id = queue.pop()!;
    const field = byId[id];
    if (!field) continue;

    // Link: nothing else to add
    if (field.type === FieldType.Link) {
      wanted.add(field.id);
      continue;
    }

    // Lookup / Rollup: include its link field via model method
    if (
      field.isLookup ||
      field.type === FieldType.Rollup ||
      field.type === FieldType.ConditionalRollup
    ) {
      const link = field.getLinkField(table);
      if (link && !wanted.has(link.id)) {
        wanted.add(link.id);
        queue.push(link.id);
      }
      continue;
    }

    // Formula: recursively include references
    if (field.type === FieldType.Formula) {
      if (visitedFormula.has(field.id)) continue;
      visitedFormula.add(field.id);
      const refs = (field as FormulaFieldCore).getReferenceFields(table);
      for (const rf of refs) {
        if (!rf) continue;
        if (!wanted.has(rf.id)) {
          wanted.add(rf.id);
          queue.push(rf.id);
        }
      }
    }
  }

  // Return in ordered order
  return ordered.filter((f) => wanted.has(f.id));
}

/**
 * Determine whether a field is date-like (i.e., represents a datetime value).
 * - True for Date, CreatedTime, LastModifiedTime
 * - True for Formula fields whose result cellValueType is DateTime
 */
export function isDateLikeField(field: FieldCore): boolean {
  if (
    field.type === FieldType.Date ||
    field.type === FieldType.CreatedTime ||
    field.type === FieldType.LastModifiedTime
  ) {
    return true;
  }
  if (field.type === FieldType.Formula) {
    const f = field as FormulaFieldCore;
    return f.cellValueType === CellValueType.DateTime;
  }
  return false;
}
