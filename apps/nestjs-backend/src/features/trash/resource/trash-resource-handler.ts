import type { TrashType } from '@teable/openapi';
import type { Path } from 'nestjs-i18n';
import type { I18nTranslations } from '../../../types/i18n.generated';

/** A trash item as a handler needs it. */
export type ITrashResourceItem = {
  id?: string;
  resourceType: TrashType;
  resourceId: string;
  parentId?: string | null;
};

/**
 * What the trash lends a handler while it restores or purges: the trash's own handling of one
 * entry, for a kind whose entry brings others along (a folder).
 */
export interface ITrashFlow {
  /** Set by the retention sweep: no caller's scope to check, no one to write audit rows for. */
  readonly ignorePermissionCheck: boolean;
  /** Whether the resource an entry names is in use, which makes the entry stale. */
  isLive(item: { resourceType: string; resourceId: string }): Promise<boolean>;
  /**
   * Restores one resource as its own entry's restore would; true when it committed on a
   * connection of its own, outside the caller's transaction.
   */
  restoreItem(item: { resourceType: TrashType; resourceId: string }): Promise<boolean>;
  /** Purges one entry as its own purge would, with its audit row. */
  purgeItem(item: ITrashResourceItem & { id: string }): Promise<void>;
  describe(item: ITrashResourceItem): Promise<Record<string, unknown> | undefined>;
  auditPermanentDelete(
    item: ITrashResourceItem,
    described: Record<string, unknown> | undefined
  ): Promise<void>;
}

/**
 * What the trash does with one kind of resource. The trash itself resolves the project, takes the
 * lock, checks the data database is writable and the caller's scope (from the resource's
 * descriptor), drops stale nodes and writes the audit rows: a handler only reads and changes its
 * own resource.
 *
 * `baseId` is the project the resource is in, or is (a project's own entry); null for a space.
 */
export interface ITrashResourceHandler {
  readonly type: TrashType;
  /** The i18n key of the not-found error when the resource is gone. */
  readonly notFoundI18nKey: Path<I18nTranslations['sdk']>;
  /** The audit actions the trash writes; unset where the resource's own service writes the row. */
  readonly auditActions: { restore?: string; permanentDelete?: string };

  /** The deleted resources of this kind in a project, for the project's trash list. */
  listTrashed(baseId: string): Promise<{ id: string; name: string }[]>;
  /** Which of these resources are in use, not deleted: their trash rows are stale. */
  findLiveIds(resourceIds: string[]): Promise<Set<string>>;
  /** The name and scope columns of the item's audit row, read while the resource exists. */
  describe(item: ITrashResourceItem): Promise<Record<string, unknown> | undefined>;
  /**
   * When the resource was deleted and what its trash entry sits under (its project, or a project's
   * space), for the entry its delete event writes. Unset for a kind whose delete writes its own.
   */
  findTrashed?(resourceId: string): Promise<{ deletedTime: Date | null; parentId?: string } | null>;
  /** The project the resource is in, or is; null when it is gone, or for a space. */
  findBaseId(resourceId: string): Promise<string | null>;
  /** Brings the resource back; a kind that holds others returns those it brought back too. */
  restore(
    baseId: string | null,
    resourceId: string,
    flow: ITrashFlow
  ): Promise<ITrashResourceItem[] | void>;
  /**
   * Whether this request's restore commits on a connection of its own (a v2 table): the trash runs
   * it outside a transaction, which would only hold its connection and time out waiting for it.
   */
  ownsRestoreTransaction?(): boolean;
  /** Deletes the resources for good, with their trash rows. */
  purge(baseId: string | null, resourceIds: string[], flow: ITrashFlow): Promise<void>;
  /**
   * Set for a kind that holds others (a folder): emptying a project's trash purges what they held
   * kind by kind, then calls this for the emptied ones.
   */
  purgeEmptied?(baseId: string): Promise<void>;
}

/** A handler whose kind's delete event the trash listener records: it reads the trashed state. */
export type ITrashRecordedHandler = ITrashResourceHandler &
  Required<Pick<ITrashResourceHandler, 'findTrashed'>>;

/**
 * The handlers an edition's trash module lists. Listed per module, not discovered app-wide: the
 * EE app also loads the community modules, whose providers are bound to the community services.
 */
export const TRASH_RESOURCE_HANDLERS = Symbol('TRASH_RESOURCE_HANDLERS');
