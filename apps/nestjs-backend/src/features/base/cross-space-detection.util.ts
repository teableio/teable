import { FieldType } from '@teable/core';

export interface ICrossSpaceFieldInput {
  id: string;
  type: string;
  isLookup?: boolean | null;
  isConditionalLookup?: boolean | null;
  options?: unknown;
  lookupOptions?: unknown;
}

export function parseFieldJson(raw: unknown): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function extractForeignTableId(field: ICrossSpaceFieldInput): string | undefined {
  const isLinkField = field.type === FieldType.Link && !field.isLookup;
  const isCondLookup = Boolean(field.isLookup && field.isConditionalLookup);
  const isCondRollup = field.type === FieldType.ConditionalRollup;
  if (!isLinkField && !isCondLookup && !isCondRollup) return undefined;
  const blob = parseFieldJson(isCondLookup ? field.lookupOptions : field.options);
  const value = blob?.foreignTableId;
  return typeof value === 'string' && value ? value : undefined;
}

export interface ICollectCrossSpaceAffectedArgs {
  fields: ICrossSpaceFieldInput[];
  /**
   * Returns true when foreignTableId resolves to a different space than the
   * duplicate destination. Should return false when the foreign table is
   * unknown/deleted so unresolvable references are not flagged.
   */
  isForeignCrossSpace: (foreignTableId: string) => boolean;
  /** Returns true when the foreign table belongs to a table being duplicated. */
  isForeignInternal?: (foreignTableId: string) => boolean;
}

/**
 * Pure transitive-closure detector. Given raw fields and a predicate that
 * decides whether a `foreignTableId` is cross-space, returns the IDs of fields
 * that must be downgraded:
 *   - direct cross-space link/conditionalLookup/conditionalRollup
 *   - link-based lookup/rollup whose lookupOptions.linkFieldId chains (possibly
 *     through other lookups) to a cross-space link
 */
export function collectCrossSpaceAffectedFieldIds(
  args: ICollectCrossSpaceAffectedArgs
): Set<string> {
  return new Set(computeCrossSpaceFieldLevels(args).keys());
}

/**
 * Returns id → BFS depth: 0 = direct cross-space link/condLookup/condRollup,
 * 1 = lookup/rollup that depends on a depth-0 link, 2 = lookup that depends on
 * a depth-1 lookup, etc. Sort by **descending** depth to obtain a safe
 * conversion order: dependent fields must be converted to text BEFORE the link
 * they read from is downgraded — otherwise the cascade recompute inside
 * `convertField` resolves the lookup against the (now text) source and
 * overwrites its stored cellValue with null.
 */
export function computeCrossSpaceFieldLevels(
  args: ICollectCrossSpaceAffectedArgs
): Map<string, number> {
  const { fields, isForeignCrossSpace, isForeignInternal } = args;

  const level = new Map<string, number>();
  for (const f of fields) {
    const ft = extractForeignTableId(f);
    if (!ft) continue;
    if (isForeignInternal?.(ft)) continue;
    if (isForeignCrossSpace(ft)) level.set(f.id, 0);
  }
  if (level.size === 0) return level;

  const crossSpaceLinkIds = new Set(
    fields
      .filter((f) => f.type === FieldType.Link && !f.isLookup && level.has(f.id))
      .map((f) => f.id)
  );

  let grew = true;
  while (grew) {
    grew = false;
    const snapshot = new Map(level);
    for (const f of fields) {
      if (level.has(f.id)) continue;
      const linkFieldId = parseFieldJson(f.lookupOptions)?.linkFieldId;
      if (typeof linkFieldId !== 'string') continue;
      let depLevel: number | undefined;
      if (crossSpaceLinkIds.has(linkFieldId)) depLevel = 0;
      else if (snapshot.has(linkFieldId)) depLevel = snapshot.get(linkFieldId);
      if (depLevel !== undefined) {
        level.set(f.id, depLevel + 1);
        grew = true;
      }
    }
  }
  return level;
}

/**
 * Sort affected field rows for sequential convertField: deepest (highest depth)
 * first so a dependent lookup's stored value is snapshotted to text via its
 * own cellValue2String BEFORE the underlying link is downgraded.
 */
export function sortByConversionDepth<T extends { fieldId: string }>(
  rows: T[],
  levels: Map<string, number>
): T[] {
  return [...rows].sort((a, b) => (levels.get(b.fieldId) ?? 0) - (levels.get(a.fieldId) ?? 0));
}
