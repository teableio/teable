import type { IGroupHeaderPoint, IGroupPoint } from '@teable/openapi';
import { GroupPointType } from '@teable/openapi';

interface ICollapsedGroupChangeResult<T> {
  groupPoints: IGroupPoint[] | null;
  recordMap: { [index: number]: T };
}

export type IGroupRowCountMap = { [groupId: string]: number };

// visible-row segment kept across the change: rows [start, end) shift by delta
interface IKeptRowSegment {
  start: number;
  end: number;
  delta: number;
}

interface ICollapseWalkContext {
  nextCollapsedIds: ReadonlySet<string>;
  knownRowCounts?: IGroupRowCountMap;
  nextGroupPoints: IGroupPoint[];
  // dropping points nested deeper than this (inside a newly collapsed group)
  removeDepth: number;
  // row indexes behind an expanded group of unknown size cannot be computed
  unknownShift: boolean;
  oldIndex: number;
  newIndex: number;
}

// point.isCollapsed is the on-screen state the row layout was built from
// (rows of flagged groups are already absent), so it is the diff baseline
const visitHeaderPoint = (point: IGroupHeaderPoint, ctx: ICollapseWalkContext): void => {
  if (point.depth > ctx.removeDepth) return;
  const isCollapsed = ctx.nextCollapsedIds.has(point.id);
  ctx.nextGroupPoints.push(point.isCollapsed === isCollapsed ? point : { ...point, isCollapsed });
  ctx.removeDepth = isCollapsed && !point.isCollapsed ? point.depth : Number.MAX_SAFE_INTEGER;
  if (isCollapsed || !point.isCollapsed) return;

  // newly expanded: restore a row block of the last known size, so everything
  // behind keeps its exact position while the block itself loads; the size can
  // be stale (edits while collapsed), which the authoritative delivery corrects
  const knownCount = ctx.knownRowCounts?.[point.id];
  if (knownCount == null) {
    ctx.unknownShift = true;
    return;
  }
  if (knownCount > 0) {
    ctx.nextGroupPoints.push({ type: GroupPointType.Row, count: knownCount });
    ctx.newIndex += knownCount;
  }
};

const remapRecordMap = <T>(
  recordMap: { [index: number]: T },
  segments: IKeptRowSegment[]
): { [index: number]: T } => {
  const nextRecordMap: { [index: number]: T } = {};
  const indexes = Object.keys(recordMap)
    .map(Number)
    .sort((a, b) => a - b);
  let segmentCursor = 0;
  for (const index of indexes) {
    while (segmentCursor < segments.length && segments[segmentCursor].end <= index) {
      segmentCursor++;
    }
    const segment = segments[segmentCursor];
    if (segment == null || index < segment.start) continue;
    nextRecordMap[index + segment.delta] = recordMap[index];
  }
  return nextRecordMap;
};

// Locally derive the group layout and loaded-row placement after a
// collapse/expand toggle, mirroring what the server would return for the new
// collapsedGroupIds. Collapsing is fully computable (the covered points and
// row counts are on hand). Expanding restores the group's last known row
// count from knownRowCounts when available; without one, its hidden size is
// unknown, so loaded rows behind the first such group are dropped rather
// than misplaced. Rows outside any kept segment (including a stale tail
// beyond the grouped rows) are dropped for the same reason: data whose
// position cannot be computed must not be placed.
export const applyCollapsedGroupChange = <T>(
  groupPoints: IGroupPoint[] | null,
  recordMap: { [index: number]: T },
  nextCollapsedIds: ReadonlySet<string>,
  knownRowCounts?: IGroupRowCountMap
): ICollapsedGroupChangeResult<T> => {
  // no known layout — nothing is placeable
  if (groupPoints == null) return { groupPoints: null, recordMap: {} };

  const keptSegments: IKeptRowSegment[] = [];
  const ctx: ICollapseWalkContext = {
    nextCollapsedIds,
    knownRowCounts,
    nextGroupPoints: [],
    removeDepth: Number.MAX_SAFE_INTEGER,
    unknownShift: false,
    oldIndex: 0,
    newIndex: 0,
  };

  for (const point of groupPoints) {
    if (point.type === GroupPointType.Header) {
      visitHeaderPoint(point, ctx);
      continue;
    }

    const { count } = point;
    if (ctx.removeDepth !== Number.MAX_SAFE_INTEGER) {
      ctx.oldIndex += count;
      continue;
    }
    ctx.nextGroupPoints.push(point);
    if (!ctx.unknownShift) {
      keptSegments.push({
        start: ctx.oldIndex,
        end: ctx.oldIndex + count,
        delta: ctx.newIndex - ctx.oldIndex,
      });
    }
    ctx.oldIndex += count;
    ctx.newIndex += count;
  }

  return {
    groupPoints: ctx.nextGroupPoints,
    recordMap: remapRecordMap(recordMap, keptSegments),
  };
};

// Last known visible row count per group id, extracted from a group-point
// list. Every expanded header is recorded — including a true zero when its
// whole subtree is collapsed, which overwrites a count that went stale when
// the children were collapsed. Collapsed headers yield nothing, so the
// caller's merge keeps their previously known value — which is exactly what
// the expand patch needs later.
export const collectGroupRowCounts = (groupPoints: IGroupPoint[]): IGroupRowCountMap => {
  const counts: IGroupRowCountMap = {};
  // active expanded header ids, outermost first; dense by construction
  const stack: string[] = [];
  for (const point of groupPoints) {
    if (point.type === GroupPointType.Header) {
      stack.length = Math.min(stack.length, point.depth);
      if (!point.isCollapsed) {
        stack.push(point.id);
        counts[point.id] ??= 0;
      }
      continue;
    }
    for (const id of stack) {
      counts[id] += point.count;
    }
  }
  return counts;
};
