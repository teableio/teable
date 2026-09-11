import type { IRole } from '@teable/core';
import { getMaxLevelRole } from '../../../utils/get-max-level-role';

export type IBaseVisitRow = {
  resourceId: string;
  lastVisitTime: Date | string;
  resourceRole: IRole;
};

export const mergeBaseVisitRows = <T extends IBaseVisitRow>(rows: ReadonlyArray<T>): T[] => {
  const latestByResourceId = new Map<string, T>();
  for (const row of rows) {
    const previous = latestByResourceId.get(row.resourceId);
    if (!previous) {
      latestByResourceId.set(row.resourceId, row);
      continue;
    }
    const rowTime = new Date(row.lastVisitTime).getTime();
    const previousTime = new Date(previous.lastVisitTime).getTime();
    const newer = rowTime > previousTime ? row : previous;
    latestByResourceId.set(row.resourceId, {
      ...newer,
      resourceRole: getMaxLevelRole([
        { roleName: previous.resourceRole },
        { roleName: row.resourceRole },
      ]),
    });
  }
  return [...latestByResourceId.values()].sort(
    (left, right) =>
      new Date(right.lastVisitTime).getTime() - new Date(left.lastVisitTime).getTime()
  );
};
