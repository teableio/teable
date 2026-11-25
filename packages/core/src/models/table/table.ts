export class TableCore {
  id!: string;

  name!: string;

  dbTableName!: string;

  dbViewName?: string | null;

  icon?: string;

  description?: string;

  lastModifiedTime!: string;

  defaultViewId!: string;

  /**
   * Row-level actor attribution capability. `0` means the four actor columns are not enabled
   * for this table (legacy default); `1` means they were confirmed published. It is read-only
   * and is not the optimistic-lock `version`.
   */
  actorStorageVersion: 0 | 1 = 0;
}
