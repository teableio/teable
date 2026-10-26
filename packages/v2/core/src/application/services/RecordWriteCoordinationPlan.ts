export type RecordWriteCoordinationPlan =
  | { readonly mode: 'none'; readonly reason: 'ordered'; readonly requiresFreshTable: false }
  | {
      readonly mode: 'shared';
      readonly reason: 'metadata-read';
      readonly requiresFreshTable: false;
    }
  | {
      readonly mode: 'exclusive';
      readonly reason: 'metadata-write';
      readonly requiresFreshTable: true;
    };

export const sharedRecordWritePlan: RecordWriteCoordinationPlan = {
  mode: 'shared',
  reason: 'metadata-read',
  requiresFreshTable: false,
};

export const exclusiveRecordWritePlan: RecordWriteCoordinationPlan = {
  mode: 'exclusive',
  reason: 'metadata-write',
  requiresFreshTable: true,
};

/**
 * Initial lease plan for record writes that can move records between views.
 *
 * T8080: ordered updates still skip coordination (`mode: 'none'`) because the
 * order column is a view concern they manage on their own path. Ordered
 * *creates* must not use this shortcut: their row-order column is created
 * before the lease (`IRecordOrderColumnPreparer.prepareOrderColumn`) and the write
 * then runs under the normal shared/exclusive plan, so schema coordination
 * always covers the metadata read and any select-option write.
 */
export const preLeasePlan = (intent: { hasOrder: boolean }): RecordWriteCoordinationPlan =>
  intent.hasOrder
    ? { mode: 'none', reason: 'ordered', requiresFreshTable: false }
    : sharedRecordWritePlan;
