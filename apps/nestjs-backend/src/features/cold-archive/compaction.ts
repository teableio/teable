import type { IScannedPartKey } from './part-scan';

// Month-compaction decisions shared by every cold subsystem. The orchestration
// itself (writer, sorter, truncation) stays per-subsystem because it is typed
// on the row; what is common is WHEN to compact, WHICH keys a run may write,
// and WHICH keys it may then delete — the three places a mistake corrupts the
// month rather than merely wasting work.

export interface IMonthCompactionPlan<TPart extends IScannedPartKey> {
  /** set when the month needs no rewrite; the caller returns early */
  skippedReason?: 'no-day-parts' | 'empty-month';
  /** day parts first: the merge consumes them in that order */
  inputs: TPart[];
  /**
   * First seq a rewrite may claim. Never write a key we are still reading:
   * start past the existing max month seq and heal the superseded keys after.
   */
  startSeq: number;
  inputParts: number;
}

export const planMonthCompaction = <TPart extends IScannedPartKey & { seq: number }>(
  parts: TPart[],
  options?: { force?: boolean }
): IMonthCompactionPlan<TPart> => {
  const dayParts = parts.filter((part) => part.kind === 'day');
  const monthParts = parts.filter((part) => part.kind === 'month');
  const startSeq = monthParts.reduce((max, part) => Math.max(max, part.seq + 1), 0);
  const base = { inputs: [...dayParts, ...monthParts], startSeq, inputParts: parts.length };

  // A big month legitimately splits into several parts, so "converged" means
  // one GENERATION, not one part: several generations mean a heal pass died
  // mid-delete and the stale one must be rewritten away. Legacy tokenless keys
  // count as one indistinguishable generation; a month mixing them with
  // tokened keys therefore recompacts and converges.
  const monthGenerations = new Set(monthParts.map((part) => part.runToken)).size;
  if (dayParts.length === 0 && monthGenerations <= 1 && !options?.force) {
    return { ...base, skippedReason: 'no-day-parts' };
  }
  if (parts.length === 0) return { ...base, skippedReason: 'empty-month' };
  return base;
};

/**
 * Replace exactly the consumed inputs in the stats map. An entry that landed
 * after this run's snapshot belongs to a concurrent run and must survive.
 */
export const swapCompactedStatsEntries = <TEntry extends { key: string }>(
  parts: Record<string, TEntry>,
  inputs: IScannedPartKey[],
  written: TEntry[]
): void => {
  const inputKeys = new Set(inputs.map((input) => input.key));
  for (const key of Object.keys(parts)) {
    if (inputKeys.has(key)) delete parts[key];
  }
  for (const entry of written) {
    parts[entry.key] = entry;
  }
};

/** heal: exactly what this run consumed and superseded, nothing else */
export const supersededKeys = (inputs: IScannedPartKey[], written: { key: string }[]): string[] => {
  const writtenKeys = new Set(written.map((entry) => entry.key));
  return inputs.filter((input) => !writtenKeys.has(input.key)).map((input) => input.key);
};
