import type { Action } from '@teable/core';
import type { IVcsHistoryTableScope, IVcsRecordHistoryWindow } from '@teable/v2-vcs/server';

export const VCS_HISTORY_AUTHORITY = Symbol('VCS_HISTORY_AUTHORITY');

export interface IVcsHistoryAuthority {
  resolveRecordHistoryWindow(spaceId: string): Promise<IVcsRecordHistoryWindow>;
  resolveTableGrant(
    baseId: string,
    tableId: string
  ): Promise<{
    readonly actions: readonly Action[];
    readonly historyFieldsForRecords?: IVcsHistoryTableScope['historyFieldsForRecords'];
  }>;
}
