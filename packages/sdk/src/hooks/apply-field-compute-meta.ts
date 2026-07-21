import type { IFieldVo } from '@teable/core';

export type FieldComputeMetaClient = NonNullable<IFieldVo['computeMeta']>;

export const isActiveComputeStatus = (status: string | undefined): boolean =>
  status === 'queued' || status === 'running';

/**
 * Whether a field column should show calculating chrome.
 * Prefer `computeMetaOverride` from the live activity map so theme updates
 * even when the fields[] array identity is stable.
 */
export function isFieldCalculating(
  field: { isPending?: boolean; computeMeta?: { status?: string } },
  computeMetaOverride?: { status?: string }
): boolean {
  const status = computeMetaOverride?.status ?? field.computeMeta?.status;
  return Boolean(field.isPending) || isActiveComputeStatus(status);
}

/**
 * Apply projected compute activity onto a field instance used by the grid.
 * Mutates the field so use-grid-columns can read computeMeta / isPending.
 */
export function applyFieldComputeMeta(
  field: { id: string; computeMeta?: FieldComputeMetaClient; isPending?: boolean },
  meta: FieldComputeMetaClient | undefined
): boolean {
  if (meta) {
    const nextPending = isActiveComputeStatus(meta.status);
    if (
      field.computeMeta?.status !== meta.status ||
      field.computeMeta?.lastDurationMs !== meta.lastDurationMs ||
      field.isPending !== nextPending
    ) {
      field.computeMeta = meta;
      field.isPending = nextPending || undefined;
      return true;
    }
    return false;
  }

  if (field.computeMeta?.status && field.computeMeta.status !== 'idle') {
    field.computeMeta = { status: 'idle' };
    field.isPending = undefined;
    return true;
  }
  return false;
}
