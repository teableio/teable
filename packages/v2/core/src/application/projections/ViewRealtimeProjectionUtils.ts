import type { ITableViewPersistenceDTO } from '../../ports/mappers/TableMapper';
import type { RealtimeChange } from '../../ports/RealtimeChange';

export const toStandaloneViewRealtimeSnapshot = (view: ITableViewPersistenceDTO): unknown => {
  const query = view.query;
  const sort =
    query?.sort === undefined && query?.manualSort === undefined
      ? undefined
      : {
          sortObjs: query.sort ?? [],
          ...(query.manualSort !== undefined ? { manualSort: query.manualSort } : {}),
        };

  return {
    ...view,
    ...(view.sourceFilter != null ? { filter: view.sourceFilter } : {}),
    ...(sort !== undefined ? { sort } : {}),
    ...(query?.group?.length ? { group: query.group } : {}),
  };
};

export const withPersistedViewAuditChanges = (
  view: ITableViewPersistenceDTO,
  change: RealtimeChange | ReadonlyArray<RealtimeChange>,
  pathPrefix: ReadonlyArray<string | number> = []
): RealtimeChange | ReadonlyArray<RealtimeChange> => {
  const auditChanges: RealtimeChange[] = [];
  if (view.lastModifiedBy !== undefined) {
    auditChanges.push({
      type: 'set',
      path: [...pathPrefix, 'lastModifiedBy'],
      value: view.lastModifiedBy,
    });
  }
  if (view.lastModifiedTime !== undefined) {
    auditChanges.push({
      type: 'set',
      path: [...pathPrefix, 'lastModifiedTime'],
      value: view.lastModifiedTime,
    });
  }
  if (auditChanges.length === 0) return change;
  return [...(Array.isArray(change) ? change : [change]), ...auditChanges];
};
