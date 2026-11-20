/**
 * What an edition keeps pointing at a folder by its node id, kept in step as folders go to the
 * trash and come back. Runs inside the transaction that moves the folders.
 */
export interface IFolderLifecycleHook {
  /** These folders went to the trash, their nodes already gone. */
  onFoldersTrashed(baseId: string, folders: { id: string; resourceId: string }[]): Promise<void>;
  /** Trashed folders came back under new nodes, keyed by the folder's id. */
  onFoldersRestored(baseId: string, nodeIdByFolderId: Map<string, string>): Promise<void>;
}

/** The hooks an edition's modules list; none in the community edition. */
export const FOLDER_LIFECYCLE_HOOKS = Symbol('FOLDER_LIFECYCLE_HOOKS');
