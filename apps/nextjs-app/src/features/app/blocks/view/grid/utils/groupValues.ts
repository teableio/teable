import type { IGroupPointsVo } from '@teable/openapi';
import { GroupPointType } from '@teable/openapi';

// the backend appends this synthetic header for the rows beyond the
// maxGroupPoints truncation limit (record.service getGroupRelatedData);
// its value is the display label 'Unknown', not a real group value
const OVERFLOW_GROUP_ID = 'unknown';

// Group header values for the group containing the given record row index,
// ordered by group depth — the depth of the backend's group points, which are
// built from the permission-filtered group fields only, so callers must index
// them against the same filtered list. Sourced from the server-computed group
// points, so they stay available when a group field is hidden (projected out
// of the record subscription) or the neighbor record is not loaded. Note that
// group values may be normalized (e.g. date granularity), unlike record cell
// values
export const getGroupValuesByRowIndex = (
  groupPoints: IGroupPointsVo | null | undefined,
  rowIndex: number
): unknown[] | undefined => {
  if (!groupPoints?.length || rowIndex < 0) return undefined;

  let count = 0;
  let overflow = false;
  let chain: unknown[] = [];

  for (const point of groupPoints) {
    if (point.type === GroupPointType.Header) {
      overflow = point.id === OVERFLOW_GROUP_ID;
      chain = chain.slice(0, point.depth);
      chain[point.depth] = point.value;
      continue;
    }
    if (rowIndex < count + point.count) {
      return overflow ? undefined : chain;
    }
    count += point.count;
  }
  return undefined;
};
