export interface IVcsPullCursorPage {
  readonly targetSnapshot: string;
  readonly afterSeq: number;
}

export interface IVcsPullCursor {
  readonly v: 2;
  readonly scopeTag: string;
  readonly maxSeq: number;
  readonly xmin: string;
  readonly snapshot: string;
  readonly page?: IVcsPullCursorPage;
}

export interface IPgSnapshotBounds {
  readonly xmin: string;
  readonly xmax: string;
}

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;
const PG_SNAPSHOT_RE = /^(\d+):(\d+):(\d+(?:,\d+)*)?$/;
const SCOPE_TAG_RE = /^[-\w]+$/;
const NON_NEGATIVE_INT_RE = /^\d+$/;

export function computeVcsTableScopeTag(tableIds?: readonly string[]): string {
  if (!tableIds || tableIds.length === 0) {
    return 'all';
  }
  const normalized = Array.from(
    new Set(tableIds.map((id) => id.trim()).filter((id) => id.length > 0))
  ).sort((a, b) => a.localeCompare(b));
  if (normalized.length === 0) {
    return 'all';
  }
  let hash = FNV_OFFSET_BASIS_64;
  const serialized = normalized.join('\0');
  for (let i = 0; i < serialized.length; i += 1) {
    hash ^= BigInt(serialized.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return `tbl_${hash.toString(16).padStart(16, '0')}_${String(normalized.length)}`;
}

export function isValidPgSnapshotText(raw: string): IPgSnapshotBounds | null {
  const match = PG_SNAPSHOT_RE.exec(raw);
  if (!match) {
    return null;
  }
  const xmin = match[1]!;
  const xmax = match[2]!;
  const xipCsv = match[3] ?? '';
  let xminBig: bigint;
  let xmaxBig: bigint;
  try {
    xminBig = BigInt(xmin);
    xmaxBig = BigInt(xmax);
  } catch {
    return null;
  }
  if (xminBig > xmaxBig) {
    return null;
  }
  if (xipCsv.length > 0) {
    let prev = -1n;
    for (const token of xipCsv.split(',')) {
      let xip: bigint;
      try {
        xip = BigInt(token);
      } catch {
        return null;
      }
      if (xip < xminBig || xip >= xmaxBig || xip <= prev) {
        return null;
      }
      prev = xip;
    }
  }
  return { xmin, xmax };
}

export function encodeVcsPullCursor(cursor: IVcsPullCursor): string {
  const base = `v2|${cursor.scopeTag}|${String(cursor.maxSeq)}|${cursor.snapshot}`;
  if (!cursor.page) {
    return base;
  }
  return `${base}|${cursor.page.targetSnapshot}|${String(cursor.page.afterSeq)}`;
}

function parseNonNegativeSafeInt(raw: string | undefined): number | null {
  if (!raw || !NON_NEGATIVE_INT_RE.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isValidLegacySeenList(rawSeen: string): boolean {
  if (rawSeen.length === 0) {
    return true;
  }
  for (const token of rawSeen.split(',')) {
    const seq = parseNonNegativeSafeInt(token);
    if (seq === null || seq <= 0) {
      return false;
    }
  }
  return true;
}

function decodeLegacyV1PullCursor(trimmed: string): IVcsPullCursor | null {
  const parts = trimmed.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    return null;
  }
  const xmin = parts[1] ?? '';
  const maxSeq = parseNonNegativeSafeInt(parts[2]);
  if (
    !NON_NEGATIVE_INT_RE.test(xmin) ||
    maxSeq === null ||
    !isValidLegacySeenList(parts[3] ?? '')
  ) {
    return null;
  }
  return {
    v: 2,
    scopeTag: 'legacy_v1',
    maxSeq,
    xmin,
    snapshot: `${xmin}:${xmin}:`,
  };
}

function decodeCursorPage(parts: string[]): IVcsPullCursorPage | null | undefined {
  if (parts.length === 4) {
    return undefined;
  }
  if (parts.length !== 6) {
    return null;
  }
  const targetSnapshot = parts[4] ?? '';
  const afterSeq = parseNonNegativeSafeInt(parts[5]);
  if (!isValidPgSnapshotText(targetSnapshot) || afterSeq === null) {
    return null;
  }
  return { targetSnapshot, afterSeq };
}

export function decodeVcsPullCursor(raw: string | undefined | null): IVcsPullCursor | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('v1:')) {
    return decodeLegacyV1PullCursor(trimmed);
  }

  const parts = trimmed.split('|');
  if (parts[0] !== 'v2' || (parts.length !== 4 && parts.length !== 6)) {
    return null;
  }
  const scopeTag = parts[1] ?? '';
  const maxSeq = parseNonNegativeSafeInt(parts[2]);
  const snapshot = parts[3] ?? '';
  const bounds = isValidPgSnapshotText(snapshot);
  const page = decodeCursorPage(parts);
  if (!SCOPE_TAG_RE.test(scopeTag) || maxSeq === null || !bounds || page === null) {
    return null;
  }

  return {
    v: 2,
    scopeTag,
    maxSeq,
    xmin: bounds.xmin,
    snapshot,
    ...(page ? { page } : {}),
  };
}
