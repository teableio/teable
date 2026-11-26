import { Injectable } from '@nestjs/common';

/**
 * What an edition keeps for a table outside the databases, removed once the table is deleted for
 * good. The community edition keeps nothing; an edition module registers its hook in
 * `TablePurgeHookRegistry`, which this module exports.
 */
export interface ITablePurgeHook {
  /**
   * Runs once the purge has committed. The tables' rows are gone by then, and so is their base's
   * when the base itself was purged, so the space they were in is passed along.
   */
  afterPurge(purge: { spaceId: string; tableIds: string[] }): Promise<void>;
}

/** The purge hooks of the editions, run by `TableLifecycleCleanupService` after every purge. */
@Injectable()
export class TablePurgeHookRegistry {
  private readonly hooks: ITablePurgeHook[] = [];

  register(hook: ITablePurgeHook): void {
    this.hooks.push(hook);
  }

  all(): ReadonlyArray<ITablePurgeHook> {
    return this.hooks;
  }
}
