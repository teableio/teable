import {
  computeVcsTableScopeTag,
  decodeVcsPullCursor,
  encodeVcsPullCursor,
  isValidPgSnapshotText,
  type IVcsPullCursor,
  type IVcsPullCursorPage,
} from '@teable/v2-vcs';

export { computeVcsTableScopeTag, decodeVcsPullCursor, encodeVcsPullCursor, isValidPgSnapshotText };
export type { IVcsPullCursor, IVcsPullCursorPage };

export const isCursorBeforeRetention = (
  cursor: IVcsPullCursor,
  minRetainedSeq: number,
  minRetainedXid: string
): boolean => {
  if (minRetainedSeq <= 0) {
    return false;
  }
  try {
    return (
      BigInt(cursor.xmin) <= BigInt(minRetainedXid || '0') ||
      Boolean(cursor.page && cursor.page.afterSeq < minRetainedSeq)
    );
  } catch {
    return true;
  }
};
