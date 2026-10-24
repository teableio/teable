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

export const preLeasePlan = (intent: { hasOrder: boolean }): RecordWriteCoordinationPlan =>
  intent.hasOrder
    ? { mode: 'none', reason: 'ordered', requiresFreshTable: false }
    : sharedRecordWritePlan;
