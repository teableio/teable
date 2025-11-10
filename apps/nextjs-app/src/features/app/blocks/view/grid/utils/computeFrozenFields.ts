import type { IFieldInstance } from '@teable/sdk/model';

export function computeFrozenColumnCount({
  isTouchDevice,
  frozenFieldId,
  frozenColumnCount,
  visibleColumns,
  allFields,
}: {
  isTouchDevice: boolean;
  frozenFieldId?: string;
  frozenColumnCount?: number;
  visibleColumns: { id: string }[];
  allFields: IFieldInstance[];
}): number {
  if (isTouchDevice) return 0;
  if (!frozenFieldId) return frozenColumnCount ?? 1;

  const visibleIdx = visibleColumns.findIndex((c) => c?.id === frozenFieldId);
  if (visibleIdx >= 0) return visibleIdx + 1;

  const anchorOrderIndex = allFields.findIndex((f) => f?.id === frozenFieldId);
  if (anchorOrderIndex < 0) return 0;

  let lastBefore = -1;
  for (let i = 0; i < visibleColumns.length; i++) {
    const colId = visibleColumns[i]?.id;
    const pos = allFields.findIndex((f) => f?.id === colId);
    if (pos >= 0 && pos < anchorOrderIndex) lastBefore = i;
  }
  return lastBefore >= 0 ? lastBefore + 1 : 0;
}
