export const PALETTE_RECENT_LIMIT = 12;

export interface PaletteRecentVisit {
  resourceId: string;
  viewId?: string;
  lastVisited: number;
  visitCount: number;
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w-]{1,128}$/.test(value);

export const paletteRecentKey = (userId: string, baseId: string) =>
  `teable:palette-recent:v1:${encodeURIComponent(userId)}:${encodeURIComponent(baseId)}`;

export const paletteRecentId = (visit: Pick<PaletteRecentVisit, 'resourceId' | 'viewId'>) =>
  visit.viewId ? `${visit.resourceId}/${visit.viewId}` : visit.resourceId;

/** Only identifiers and visit statistics cross the storage boundary, never resource metadata. */
export const readPaletteRecent = (userId: string, baseId: string): PaletteRecentVisit[] => {
  if (!userId || !baseId || typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(paletteRecentKey(userId, baseId)) ?? '[]'
    );
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .filter(
        (entry): entry is PaletteRecentVisit =>
          Boolean(entry) &&
          validId(entry.resourceId) &&
          (entry.viewId === undefined || validId(entry.viewId)) &&
          Number.isFinite(entry.lastVisited) &&
          entry.lastVisited > 0 &&
          Number.isSafeInteger(entry.visitCount) &&
          entry.visitCount > 0
      )
      .sort((a, b) => b.lastVisited - a.lastVisited)
      .filter((entry) => {
        const id = paletteRecentId(entry);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, PALETTE_RECENT_LIMIT)
      .map(({ resourceId, viewId, lastVisited, visitCount }) => ({
        resourceId,
        ...(viewId ? { viewId } : {}),
        lastVisited,
        visitCount: Math.min(visitCount, 9999),
      }));
  } catch {
    // Private browsing, disabled storage, and malformed older data must not break navigation.
    return [];
  }
};

export const writePaletteRecent = (
  userId: string,
  baseId: string,
  visits: PaletteRecentVisit[]
) => {
  if (!userId || !baseId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      paletteRecentKey(userId, baseId),
      JSON.stringify(
        visits
          .slice(0, PALETTE_RECENT_LIMIT)
          .map(({ resourceId, viewId, lastVisited, visitCount }) => ({
            resourceId,
            ...(viewId ? { viewId } : {}),
            lastVisited,
            visitCount,
          }))
      )
    );
  } catch {
    // Recents are optional; navigation remains available when storage is denied or full.
  }
};

export const addPaletteRecent = (
  visits: PaletteRecentVisit[],
  destination: Pick<PaletteRecentVisit, 'resourceId' | 'viewId'>,
  now = Date.now()
): PaletteRecentVisit[] => {
  const id = paletteRecentId(destination);
  const previous = visits.find((visit) => paletteRecentId(visit) === id);
  return [
    {
      ...destination,
      lastVisited: now,
      visitCount: Math.min((previous?.visitCount ?? 0) + 1, 9999),
    },
    ...visits.filter((visit) => paletteRecentId(visit) !== id),
  ].slice(0, PALETTE_RECENT_LIMIT);
};
